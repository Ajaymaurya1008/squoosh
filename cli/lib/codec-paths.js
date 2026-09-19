/**
 * Where each codec lives, and how it's built.
 *
 * This is the single list of what the CLI needs from `codecs/`. The publish
 * step reads it to copy exactly those files into the package, so adding a
 * codec here is all it takes for a release to carry it.
 *
 * `kind` picks the loader: `emscripten` builds sit next to a `.wasm` of the
 * same name, `bindgen` ones name their wasm separately.
 */
export const decoders = {
  'image/jpeg': { kind: 'emscripten', path: 'mozjpeg/dec/mozjpeg_node_dec.js' },
  'image/png': {
    kind: 'bindgen',
    path: 'png/pkg/squoosh_png.js',
    wasm: 'squoosh_png_bg.wasm',
  },
  'image/webp': { kind: 'emscripten', path: 'webp/dec/webp_node_dec.js' },
  'image/avif': { kind: 'emscripten', path: 'avif/dec/avif_node_dec.js' },
  'image/jxl': { kind: 'emscripten', path: 'jxl/dec/jxl_node_dec.js' },
  'image/webp2': { kind: 'emscripten', path: 'wp2/dec/wp2_node_dec.js' },
  'image/qoi': { kind: 'emscripten', path: 'qoi/dec/qoi_dec.js' },
};

export const encoderBuilds = {
  mozJPEG: { kind: 'emscripten', path: 'mozjpeg/enc/mozjpeg_node_enc.js' },
  // The browser prefers webp_enc_simd; there's no SIMD build for Node, and
  // both produce byte-identical output.
  webP: { kind: 'emscripten', path: 'webp/enc/webp_node_enc.js' },
  // The Node builds are a newer revision taking different options, so this
  // uses the browser's own single-threaded build. The browser reaches for
  // avif_enc_mt when threads are available, which differs slightly.
  avif: { kind: 'emscripten', path: 'avif/enc/avif_enc.js' },
  // The browser prefers jxl_enc_mt_simd; Node only has the plain build.
  jxl: { kind: 'emscripten', path: 'jxl/enc/jxl_node_enc.js' },
  // The browser uses the parallel build; optimisation is deterministic, so
  // the single-threaded one produces the same file.
  oxiPNG: {
    kind: 'bindgen',
    path: 'oxipng/pkg/squoosh_oxipng.js',
    wasm: 'squoosh_oxipng_bg.wasm',
  },
  // The browser prefers wp2_enc_mt_simd; Node only has the plain build.
  wp2: { kind: 'emscripten', path: 'wp2/enc/wp2_node_enc.js' },
  // Only a browser build exists, and it runs here unchanged.
  qoi: { kind: 'emscripten', path: 'qoi/enc/qoi_enc.js' },
};

export const resizeBuild = {
  kind: 'bindgen',
  path: 'resize/pkg/squoosh_resize.js',
  wasm: 'squoosh_resize_bg.wasm',
};

/** Every build the CLI can reach for. */
export function allBuilds() {
  return [
    ...Object.values(decoders),
    ...Object.values(encoderBuilds),
    resizeBuild,
  ];
}
