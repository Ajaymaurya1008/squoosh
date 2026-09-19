/**
 * Decoders, encoders and resizing, mirroring what the web app's workers do so
 * the same input and options produce the same bytes.
 *
 * Each entry points at the same wasm the browser runs. Where a codec ships
 * several builds (SIMD, multi-threaded), the note on that entry says which one
 * the browser picks and which one is used here.
 */
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadBindgen, loadEmscripten, ImageData } from './wasm.js';
import {
  decoders as decoderBuilds,
  encoderBuilds,
  resizeBuild,
} from './codec-paths.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Published packages carry their own copy of the codecs; a repo checkout uses
 * the ones already there.
 */
const vendored = join(here, '..', 'vendor', 'codecs');
const codecRoot = existsSync(vendored)
  ? vendored
  : join(here, '..', '..', 'codecs');

/** Load a build described in codec-paths. */
function load(build) {
  const path = join(codecRoot, build.path);
  return build.kind === 'bindgen'
    ? loadBindgen(path, build.wasm)
    : loadEmscripten(path);
}

/** Mirrors sniffMimeType in the web app's client utils. */
const magicNumbers = [
  [/^\x89PNG\x0D\x0A\x1A\x0A/, 'image/png'],
  [/^\xFF\xD8\xFF/, 'image/jpeg'],
  [/^RIFF....WEBPVP8[LX ]/s, 'image/webp'],
  [/^\x00\x00\x00 ftypavif\x00\x00\x00\x00/, 'image/avif'],
  [/^\xff\x0a/, 'image/jxl'],
  [/^\x00\x00\x00\x0cJXL \x0d\x0a\x87\x0a/, 'image/jxl'],
  [/^\xF4\xFF\x6F/, 'image/webp2'],
  [/^qoif/, 'image/qoi'],
  [/^GIF87a/, 'image/gif'],
  [/^GIF89a/, 'image/gif'],
  [/^BM/, 'image/bmp'],
];

export function sniffMimeType(buffer) {
  const head = Array.from(buffer.subarray(0, 16))
    .map((v) => String.fromCodePoint(v))
    .join('');

  for (const [pattern, mimeType] of magicNumbers) {
    if (pattern.test(head)) return mimeType;
  }
  return '';
}

const decoders = Object.fromEntries(
  Object.entries(decoderBuilds).map(([mimeType, build]) => [
    mimeType,
    async (data) => (await load(build)).decode(data),
  ]),
);

export function canDecode(mimeType) {
  return mimeType in decoders;
}

export async function decode(data) {
  const mimeType = sniffMimeType(data);
  const decoder = decoders[mimeType];

  if (!decoder) {
    throw Error(
      mimeType
        ? `Can't decode ${mimeType}`
        : "Doesn't look like an image this tool can read",
    );
  }

  const result = await decoder(data);
  if (!result) throw Error(`Couldn't decode ${mimeType}`);
  return result;
}

/**
 * Encoders, keyed by the same names the web app uses, so `--format webP`
 * refers to exactly the entry the UI calls "WebP".
 *
 * browserJPEG and browserPNG are deliberately absent: they encode through a
 * canvas, which only exists in a browser.
 */
const encoderMeta = {
  mozJPEG: { label: 'MozJPEG', extension: 'jpg' },
  webP: { label: 'WebP', extension: 'webp' },
  avif: { label: 'AVIF', extension: 'avif' },
  jxl: { label: 'JPEG XL (beta)', extension: 'jxl' },
  oxiPNG: { label: 'OxiPNG', extension: 'png' },
  wp2: { label: 'WebP v2 (unstable)', extension: 'wp2' },
  qoi: { label: 'QOI', extension: 'qoi' },
};

/**
 * Encoders, keyed by the same names the web app uses, so `--format webP`
 * refers to exactly the entry the UI calls "WebP".
 *
 * browserJPEG and browserPNG are deliberately absent: they encode through a
 * canvas, which only exists in a browser.
 */
export const encoders = Object.fromEntries(
  Object.entries(encoderMeta).map(([name, meta]) => [
    name,
    {
      ...meta,
      async encode(image, options) {
        const module = await load(encoderBuilds[name]);

        if (name === 'oxiPNG') {
          return module.optimise(
            image.data,
            image.width,
            image.height,
            options.level,
            options.interlace,
          );
        }

        const result = module.encode(
          image.data,
          image.width,
          image.height,
          options,
        );
        if (!result) throw Error('Encoding error');
        return result;
      },
    },
  ]),
);

/** Resize methods by index, as the resize worker orders them. */
const resizeMethods = ['triangle', 'catrom', 'mitchell', 'lanczos3'];

/**
 * Scale an image, matching what batch mode asks the resize worker for:
 * lanczos3, stretch, premultiplied, in linear RGB.
 */
export async function resize(image, width, height) {
  const module = await load(resizeBuild);

  const result = module.resize(
    new Uint8Array(
      image.data.buffer,
      image.data.byteOffset,
      image.data.byteLength,
    ),
    image.width,
    image.height,
    width,
    height,
    resizeMethods.indexOf('lanczos3'),
    true, // premultiply
    true, // linearRGB
  );

  return new ImageData(new Uint8ClampedArray(result.buffer), width, height);
}

/** Scale down to fit a box, preserving aspect ratio. Mirrors fitWithin. */
export function fitWithin(width, height, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / width, maxHeight / height);
  if (scale >= 1) return undefined;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
