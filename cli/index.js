#!/usr/bin/env node
/**
 * Squoosh batch compression from the command line.
 *
 * Runs the same wasm codecs as the web app's batch mode, with the same default
 * options, so the same image and settings give you the same file.
 */
import { readFile, writeFile, mkdir, stat, readdir } from 'fs/promises';
import { basename, extname, join, resolve } from 'path';
import { parseArgs } from 'util';

import { encoders } from './lib/codecs.js';
import { WorkerPool, defaultConcurrency } from './lib/pool.js';

const formatNames = Object.keys(encoders);

const usage = `
Usage: squoosh-batch [options] <files or directories...>

Options:
  -f, --format <name>    Output format, repeatable or comma-separated.
                         ${formatNames.join(', ')}
                         (default: mozJPEG)
  -o, --out-dir <dir>    Where to write results (default: ./squooshed)
  -q, --quality <n>      Quality for lossy formats, overriding the default
      --max-width <n>    Shrink images to fit this width
      --max-height <n>   Shrink images to fit this height
  -c, --concurrency <n>  Images to work on at once (default: CPUs - 1, max 4)
      --overwrite        Replace existing output files
  -h, --help             Show this

Examples:
  squoosh-batch photos/
  squoosh-batch -f webP -f avif -q 60 -o out photos/*.jpg
  squoosh-batch -f webP --max-width 2000 hero.png
`.trim();

const imageExtensions = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.avif',
  '.jxl',
  '.wp2',
  '.qoi',
  '.gif',
  '.bmp',
]);

/** Expand directories into the image files inside them. */
async function collectFiles(inputs) {
  const files = [];

  for (const input of inputs) {
    const path = resolve(input);
    let info;

    try {
      info = await stat(path);
    } catch {
      throw Error(`No such file or directory: ${input}`);
    }

    if (info.isDirectory()) {
      const entries = await readdir(path, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!imageExtensions.has(extname(entry.name).toLowerCase())) continue;
        files.push(join(path, entry.name));
      }
      continue;
    }

    files.push(path);
  }

  return files;
}

function parseFormats(values) {
  const names = (values ?? ['mozJPEG'])
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  // Accept any capitalisation, since "mozjpeg" is the obvious thing to type.
  return [...new Set(names)].map((name) => {
    const match = formatNames.find(
      (known) => known.toLowerCase() === name.toLowerCase(),
    );
    if (!match) {
      throw Error(
        `Unknown format "${name}". Available: ${formatNames.join(', ')}`,
      );
    }
    return match;
  });
}

function formatSize(bytes) {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / 1000 / 1000).toFixed(2)} MB`;
}

function formatDelta(from, to) {
  if (from === 0) return '';
  const change = Math.round(((to - from) / from) * 100);
  return `${change > 0 ? '+' : ''}${change}%`;
}

async function main() {
  let args;

  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        format: { type: 'string', short: 'f', multiple: true },
        'out-dir': { type: 'string', short: 'o' },
        quality: { type: 'string', short: 'q' },
        'max-width': { type: 'string' },
        'max-height': { type: 'string' },
        concurrency: { type: 'string', short: 'c' },
        overwrite: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (err) {
    console.error(`${err.message}\n\n${usage}`);
    process.exit(1);
  }

  if (args.values.help || args.positionals.length === 0) {
    console.log(usage);
    process.exit(args.values.help ? 0 : 1);
  }

  const number = (value, name) => {
    if (value === undefined) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw Error(`--${name} must be a positive number`);
    }
    return parsed;
  };

  const formats = parseFormats(args.values.format);
  const quality = number(args.values.quality, 'quality');
  const maxWidth = number(args.values['max-width'], 'max-width');
  const maxHeight = number(args.values['max-height'], 'max-height');
  const outDir = resolve(args.values['out-dir'] ?? 'squooshed');
  const files = await collectFiles(args.positionals);

  if (files.length === 0) throw Error('No images found');

  await mkdir(outDir, { recursive: true });
  for (const format of formats) {
    if (formats.length > 1) {
      await mkdir(join(outDir, encoders[format].extension), {
        recursive: true,
      });
    }
  }

  const concurrency = Math.min(
    number(args.values.concurrency, 'concurrency') ?? defaultConcurrency(),
    files.length,
  );

  console.log(
    `Compressing ${files.length} image${files.length === 1 ? '' : 's'} ` +
      `to ${formats.map((f) => encoders[f].label).join(', ')}` +
      `${concurrency > 1 ? ` (${concurrency} at a time)` : ''}\n`,
  );

  let sourceTotal = 0;
  const outputTotals = new Map(formats.map((format) => [format, 0]));
  let failures = 0;
  let failedFiles = 0;
  let done = 0;

  const pool = new WorkerPool(concurrency);

  // Hand every image to the pool at once and let it meter them out. Results
  // print as they land, so one slow image doesn't hold up the rest.
  const tasks = files.map(async (path) => {
    const name = basename(path);

    let result;
    try {
      result = await pool.run({ path, formats, quality, maxWidth, maxHeight });
    } catch (err) {
      failures++;
      failedFiles++;
      done++;
      console.log(
        `[${done}/${files.length}] ${name}\n    error  ${err.message}`,
      );
      return;
    }

    done++;
    const counter = `[${done}/${files.length}]`;

    sourceTotal += result.sourceSize;
    console.log(
      `${counter} ${name}  ${formatSize(result.sourceSize)} · ` +
        `${result.width}×${result.height}`,
    );

    for (const { format, data, error } of result.results) {
      const { extension, label } = encoders[format];

      if (error) {
        failures++;
        console.log(`    ${label.padEnd(20)} error  ${error}`);
        continue;
      }

      const outName = name.replace(/\.[^.]*$/, '') + '.' + extension;
      const outPath = join(
        outDir,
        formats.length > 1 ? extension : '',
        outName,
      );

      if (!args.values.overwrite) {
        try {
          await stat(outPath);
          console.log(`    ${label.padEnd(20)} skipped, file exists`);
          continue;
        } catch {
          // Doesn't exist, which is what we want.
        }
      }

      await writeFile(outPath, data);
      outputTotals.set(format, outputTotals.get(format) + data.length);
      console.log(
        `    ${label.padEnd(20)} ${formatSize(data.length).padStart(9)}  ` +
          `${formatDelta(result.sourceSize, data.length)}`,
      );
    }
  });

  await Promise.all(tasks);
  await pool.close();

  const compressed = files.length - failedFiles;
  console.log(
    `\n${compressed} image${compressed === 1 ? '' : 's'} · ` +
      `${formatSize(sourceTotal)} original` +
      (failedFiles > 0 ? `  (${failedFiles} failed)` : ''),
  );
  for (const format of formats) {
    const total = outputTotals.get(format);
    console.log(
      `  ${encoders[format].label.padEnd(20)} ${formatSize(total).padStart(
        9,
      )}  ` + `${formatDelta(sourceTotal, total)}`,
    );
  }
  console.log(`\nWritten to ${outDir}`);

  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
