#!/usr/bin/env node
/**
 * Copy the codec builds the CLI uses into the package, so an installed copy
 * doesn't need the rest of the repo.
 *
 * Runs from `prepack`, so `npm publish` and `npm pack` pick it up without
 * anyone having to remember. The list comes from lib/codec-paths.js.
 */
import { copyFile, mkdir, rm } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { allBuilds } from '../lib/codec-paths.js';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', '..', 'codecs');
const target = join(here, '..', 'vendor', 'codecs');

/** Every file a build needs: its JS, and the wasm beside it. */
function filesFor(build) {
  const wasm =
    build.kind === 'bindgen'
      ? join(dirname(build.path), build.wasm)
      : build.path.replace(/\.js$/, '.wasm');

  return [build.path, wasm];
}

const files = [...new Set(allBuilds().flatMap(filesFor))].sort();

await rm(target, { recursive: true, force: true });

let bytes = 0;

for (const file of files) {
  const to = join(target, file);
  await mkdir(dirname(to), { recursive: true });
  await copyFile(join(source, file), to);
  const { size } = await import('fs').then((fs) => fs.promises.stat(to));
  bytes += size;
}

console.log(
  `Vendored ${files.length} codec files (${(bytes / 1024 / 1024).toFixed(
    1,
  )} MB)`,
);
