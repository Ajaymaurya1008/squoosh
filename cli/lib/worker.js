/**
 * Worker entry: decodes one image and encodes it to each format.
 *
 * One image per task, so a file is decoded once and the decoded pixels never
 * cross a thread boundary - the same shape as the web app's worker pool.
 */
import { readFile } from 'fs/promises';
import { parentPort } from 'worker_threads';

import { decode, encoders, fitWithin, resize } from './codecs.js';
import { defaultOptions, qualityOption } from './defaults.js';

function optionsFor(format, quality) {
  const options = { ...defaultOptions[format] };
  const key = qualityOption[format];
  if (quality !== undefined && key) options[key] = quality;
  return options;
}

async function processFile({ path, formats, quality, maxWidth, maxHeight }) {
  const source = new Uint8Array(await readFile(path));
  const decoded = await decode(source);

  let image = decoded;
  const target =
    maxWidth || maxHeight
      ? fitWithin(
          decoded.width,
          decoded.height,
          maxWidth ?? Infinity,
          maxHeight ?? Infinity,
        )
      : undefined;

  if (target) image = await resize(decoded, target.width, target.height);

  const results = [];

  for (const format of formats) {
    try {
      const output = await encoders[format].encode(
        image,
        optionsFor(format, quality),
      );
      // Copy into a standalone buffer so it can be transferred cheaply.
      const data = new Uint8Array(output.byteLength);
      data.set(
        new Uint8Array(output.buffer, output.byteOffset, output.byteLength),
      );
      results.push({ format, data });
    } catch (err) {
      results.push({ format, error: err.message || 'Encoding failed' });
    }
  }

  return {
    sourceSize: source.length,
    width: image.width,
    height: image.height,
    results,
  };
}

parentPort.on('message', async (task) => {
  try {
    const result = await processFile(task);
    parentPort.postMessage(
      { id: task.id, result },
      result.results.filter((r) => r.data).map((r) => r.data.buffer),
    );
  } catch (err) {
    parentPort.postMessage({ id: task.id, error: err.message || String(err) });
  }
});
