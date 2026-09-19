/**
 * Loading Squoosh's wasm codecs under Node.
 *
 * The codecs ship in two shapes, neither of which Node imports as-is:
 *
 * - Emscripten builds are ES modules that still use `require` and `__dirname`,
 *   which don't exist in an ES module, and resolve their `.wasm` through
 *   `new URL(..., import.meta.url)`. Node also can't decide whether the file is
 *   CommonJS or ESM and refuses to load it at all.
 * - wasm-bindgen builds are ordinary ES modules, but their `init` defaults to
 *   fetching the `.wasm` over HTTP.
 *
 * Both are handled here so the rest of the CLI can just await a module.
 */
import { readFile } from 'fs/promises';
import { createRequire } from 'module';
import { dirname, resolve } from 'path';
import { pathToFileURL } from 'url';

/**
 * Emscripten's embind decoders build their result with `new ImageData(...)`,
 * which Node doesn't have.
 */
export class ImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

if (!globalThis.ImageData) globalThis.ImageData = ImageData;

/**
 * Some codecs only ship a browser build. Those are compiled for a worker, so
 * they look for `self` and `location` on startup. They never touch the DOM,
 * and the wasm bytes are handed to them directly, so standing these two up is
 * enough to run the exact build the browser runs.
 */
function shimWorkerGlobals(url) {
  if (!globalThis.self) globalThis.self = globalThis;
  if (!globalThis.location) globalThis.location = new URL(url);
}

const loaded = new Map();

/** Load an Emscripten codec, returning its initialised module. */
export function loadEmscripten(path) {
  const file = resolve(path);
  if (!loaded.has(file)) loaded.set(file, initEmscripten(file));
  return loaded.get(file);
}

async function initEmscripten(file) {
  const url = pathToFileURL(file).href;
  shimWorkerGlobals(url);
  const source = await readFile(file, 'utf8');

  const patched =
    `import { createRequire } from 'module';\n` +
    `const require = createRequire(${JSON.stringify(url)});\n` +
    `const __dirname = ${JSON.stringify(dirname(file))};\n` +
    // Resolve the .wasm relative to the real file rather than the data: URL
    // this is imported from.
    source.replace(/import\.meta\.url/g, JSON.stringify(url));

  const dataUrl =
    'data:text/javascript;base64,' + Buffer.from(patched).toString('base64');
  const factory = (await import(dataUrl)).default;

  // Node has a global `fetch`, which makes these builds try to stream the wasm
  // over HTTP from a filesystem path. Handing over the bytes skips all that.
  const wasmBinary = await readFile(file.replace(/\.js$/, '.wasm'));

  return factory({ wasmBinary, noInitialRun: true });
}

/** Load a wasm-bindgen codec, returning its module namespace. */
export function loadBindgen(path, wasmName) {
  const file = resolve(path);
  if (!loaded.has(file)) loaded.set(file, initBindgen(file, wasmName));
  return loaded.get(file);
}

async function initBindgen(file, wasmName) {
  const module = await import(pathToFileURL(file).href);
  const wasm = await readFile(resolve(dirname(file), wasmName));
  await module.default(wasm);
  return module;
}
