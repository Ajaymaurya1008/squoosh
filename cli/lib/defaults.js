/**
 * Default encode options, copied from the web app's encoder metadata so the
 * CLI and the UI start from identical settings.
 *
 * Each block names the file it came from. `npm run check-defaults` in this
 * directory compares these against those files and fails if they drift.
 */

/** src/features/encoders/mozJPEG/shared/meta.ts */
export const mozJPEG = {
  quality: 75,
  baseline: false,
  arithmetic: false,
  progressive: true,
  optimize_coding: true,
  smoothing: 0,
  color_space: 3, // MozJpegColorSpace.YCbCr
  quant_table: 3,
  trellis_multipass: false,
  trellis_opt_zero: false,
  trellis_opt_table: false,
  trellis_loops: 1,
  auto_subsample: true,
  chroma_subsample: 2,
  separate_chroma_quality: false,
  chroma_quality: 75,
};

/** src/features/encoders/webP/shared/meta.ts */
export const webP = {
  quality: 75,
  target_size: 0,
  target_PSNR: 0,
  method: 4,
  sns_strength: 50,
  filter_strength: 60,
  filter_sharpness: 0,
  filter_type: 1,
  partitions: 0,
  segments: 4,
  pass: 1,
  show_compressed: 0,
  preprocessing: 0,
  autofilter: 0,
  partition_limit: 0,
  alpha_compression: 1,
  alpha_filtering: 1,
  alpha_quality: 100,
  lossless: 0,
  exact: 0,
  image_hint: 0,
  emulate_jpeg_size: 0,
  thread_level: 0,
  low_memory: 0,
  near_lossless: 100,
  use_delta_palette: 0,
  use_sharp_yuv: 0,
};

/** src/features/encoders/avif/shared/meta.ts */
export const avif = {
  quality: 50,
  qualityAlpha: -1,
  denoiseLevel: 0,
  tileColsLog2: 0,
  tileRowsLog2: 0,
  speed: 6,
  subsample: 1,
  chromaDeltaQ: false,
  sharpness: 0,
  tune: 0, // AVIFTune.auto
  enableSharpYUV: false,
};

/** src/features/encoders/jxl/shared/meta.ts */
export const jxl = {
  effort: 7,
  quality: 75,
  progressive: false,
  epf: -1,
  lossyPalette: false,
  decodingSpeedTier: 0,
  photonNoiseIso: 0,
  lossyModular: false,
};

/** src/features/encoders/oxiPNG/shared/meta.ts */
export const oxiPNG = {
  level: 2,
  interlace: false,
};

/** src/features/encoders/wp2/shared/meta.ts */
export const wp2 = {
  quality: 75,
  alpha_quality: 75,
  effort: 5,
  pass: 1,
  sns: 50,
  uv_mode: 3, // UVMode.UVModeAuto
  csp_type: 0, // Csp.kYCoCg
  error_diffusion: 0,
  use_random_matrix: false,
};

/** src/features/encoders/qoi/shared/meta.ts */
export const qoi = {};

export const defaultOptions = {
  mozJPEG,
  webP,
  avif,
  jxl,
  oxiPNG,
  wp2,
  qoi,
};

/**
 * Which option carries "quality" for each format, so --quality can be applied
 * without the user knowing each codec's option names. Formats missing from
 * here are lossless and ignore it.
 */
export const qualityOption = {
  mozJPEG: 'quality',
  webP: 'quality',
  avif: 'quality',
  jxl: 'quality',
  wp2: 'quality',
};
