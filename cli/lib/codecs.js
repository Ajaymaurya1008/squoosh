/**
 * Decoders, encoders and resizing, mirroring what the web app's workers do so
 * the same input and options produce the same bytes.
 *
 * Each entry points at the same wasm the browser runs. Where a codec ships
 * several builds (SIMD, multi-threaded), the note on that entry says which one
 * the browser picks and which one is used here.
 */
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadBindgen, loadEmscripten, ImageData } from './wasm.js';

const here = dirname(fileURLToPath(import.meta.url));
const codecs = join(here, '..', '..', 'codecs');

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

const decoders = {
  'image/jpeg': async (data) => {
    const module = await loadEmscripten(
      join(codecs, 'mozjpeg/dec/mozjpeg_node_dec.js'),
    );
    return module.decode(data);
  },
  'image/png': async (data) => {
    const module = await loadBindgen(
      join(codecs, 'png/pkg/squoosh_png.js'),
      'squoosh_png_bg.wasm',
    );
    return module.decode(data);
  },
  'image/webp': async (data) => {
    const module = await loadEmscripten(
      join(codecs, 'webp/dec/webp_node_dec.js'),
    );
    return module.decode(data);
  },
  'image/avif': async (data) => {
    const module = await loadEmscripten(
      join(codecs, 'avif/dec/avif_node_dec.js'),
    );
    return module.decode(data);
  },
  'image/jxl': async (data) => {
    const module = await loadEmscripten(
      join(codecs, 'jxl/dec/jxl_node_dec.js'),
    );
    return module.decode(data);
  },
  'image/webp2': async (data) => {
    const module = await loadEmscripten(
      join(codecs, 'wp2/dec/wp2_node_dec.js'),
    );
    return module.decode(data);
  },
  'image/qoi': async (data) => {
    const module = await loadEmscripten(join(codecs, 'qoi/dec/qoi_dec.js'));
    return module.decode(data);
  },
};

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
export const encoders = {
  mozJPEG: {
    label: 'MozJPEG',
    extension: 'jpg',
    // One build everywhere.
    async encode(image, options) {
      const module = await loadEmscripten(
        join(codecs, 'mozjpeg/enc/mozjpeg_node_enc.js'),
      );
      return module.encode(image.data, image.width, image.height, options);
    },
  },
  webP: {
    label: 'WebP',
    extension: 'webp',
    // The browser prefers webp_enc_simd; there's no SIMD build for Node, but
    // both produce byte-identical output.
    async encode(image, options) {
      const module = await loadEmscripten(
        join(codecs, 'webp/enc/webp_node_enc.js'),
      );
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
  avif: {
    label: 'AVIF',
    extension: 'avif',
    // The Node builds are a newer revision that takes different options, so
    // this uses the browser's own single-threaded build. The browser reaches
    // for avif_enc_mt when threads are available, which can differ slightly.
    async encode(image, options) {
      const module = await loadEmscripten(join(codecs, 'avif/enc/avif_enc.js'));
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
  jxl: {
    label: 'JPEG XL (beta)',
    extension: 'jxl',
    // The browser prefers jxl_enc_mt_simd; Node only has the plain build.
    async encode(image, options) {
      const module = await loadEmscripten(
        join(codecs, 'jxl/enc/jxl_node_enc.js'),
      );
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
  oxiPNG: {
    label: 'OxiPNG',
    extension: 'png',
    // The browser uses the parallel build; optimisation is deterministic, so
    // the single-threaded one produces the same file.
    async encode(image, options) {
      const module = await loadBindgen(
        join(codecs, 'oxipng/pkg/squoosh_oxipng.js'),
        'squoosh_oxipng_bg.wasm',
      );
      return module.optimise(
        image.data,
        image.width,
        image.height,
        options.level,
        options.interlace,
      );
    },
  },
  wp2: {
    label: 'WebP v2 (unstable)',
    extension: 'wp2',
    // The browser prefers wp2_enc_mt_simd; Node only has the plain build.
    async encode(image, options) {
      const module = await loadEmscripten(
        join(codecs, 'wp2/enc/wp2_node_enc.js'),
      );
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
  qoi: {
    label: 'QOI',
    extension: 'qoi',
    // Only a browser build exists, and it runs here unchanged.
    async encode(image, options) {
      const module = await loadEmscripten(join(codecs, 'qoi/enc/qoi_enc.js'));
      return module.encode(image.data, image.width, image.height, options);
    },
  },
};

/** Resize methods by index, as the resize worker orders them. */
const resizeMethods = ['triangle', 'catrom', 'mitchell', 'lanczos3'];

/**
 * Scale an image, matching what batch mode asks the resize worker for:
 * lanczos3, stretch, premultiplied, in linear RGB.
 */
export async function resize(image, width, height) {
  const module = await loadBindgen(
    join(codecs, 'resize/pkg/squoosh_resize.js'),
    'squoosh_resize_bg.wasm',
  );

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
