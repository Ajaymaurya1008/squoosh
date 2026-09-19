/**
 * Shared image decode/encode helpers.
 *
 * These are used by both the single-image editor (Compress) and the batch
 * compressor (Batch), so there's one implementation of "bytes in, bytes out".
 */
import {
  abortable,
  assertSignal,
  blobToImg,
  blobToText,
  builtinDecode,
  canDecodeImageType,
  sniffMimeType,
  ImageMimeTypes,
} from './index';
import { drawableToImageData } from './canvas';
import { EncoderState, encoderMap } from '../feature-meta';
import type WorkerBridge from '../worker-bridge';

export interface SourceImage {
  file: File;
  decoded: ImageData;
  preprocessed: ImageData;
  vectorImage?: HTMLImageElement;
}

export async function decodeImage(
  signal: AbortSignal,
  blob: Blob,
  workerBridge: WorkerBridge,
): Promise<ImageData> {
  assertSignal(signal);
  const mimeType = await abortable(signal, sniffMimeType(blob));
  const canDecode = await abortable(signal, canDecodeImageType(mimeType));

  try {
    if (!canDecode) {
      if (mimeType === 'image/avif') {
        return await workerBridge.avifDecode(signal, blob);
      }
      if (mimeType === 'image/webp') {
        return await workerBridge.webpDecode(signal, blob);
      }
      if (mimeType === 'image/jxl') {
        return await workerBridge.jxlDecode(signal, blob);
      }
      if (mimeType === 'image/webp2') {
        return await workerBridge.wp2Decode(signal, blob);
      }
      if (mimeType === 'image/qoi') {
        return await workerBridge.qoiDecode(signal, blob);
      }
    }
    // Otherwise fall through and try built-in decoding for a laugh.
    return await builtinDecode(signal, blob);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    console.log(err);
    throw Error("Couldn't decode image");
  }
}

export async function processSvg(
  signal: AbortSignal,
  blob: Blob,
): Promise<HTMLImageElement> {
  assertSignal(signal);
  // Firefox throws if you try to draw an SVG to canvas that doesn't have width/height.
  // In Chrome it loads, but drawImage behaves weirdly.
  // This function sets width/height if it isn't already set.
  const parser = new DOMParser();
  const text = await abortable(signal, blobToText(blob));
  const document = parser.parseFromString(text, 'image/svg+xml');
  const svg = document.documentElement!;

  if (svg.hasAttribute('width') && svg.hasAttribute('height')) {
    return blobToImg(blob);
  }

  const viewBox = svg.getAttribute('viewBox');
  if (viewBox === null) throw Error('SVG must have width/height or viewBox');

  const viewboxParts = viewBox.split(/\s+/);
  svg.setAttribute('width', viewboxParts[2]);
  svg.setAttribute('height', viewboxParts[3]);

  const serializer = new XMLSerializer();
  const newSource = serializer.serializeToString(document);
  return abortable(
    signal,
    blobToImg(new Blob([newSource], { type: 'image/svg+xml' })),
  );
}

/**
 * Decode a file to ImageData, special-casing SVG so it can be re-rasterised at
 * other sizes later.
 */
export async function decodeFile(
  signal: AbortSignal,
  file: File,
  workerBridge: WorkerBridge,
): Promise<{ decoded: ImageData; vectorImage?: HTMLImageElement }> {
  // Special-case SVG. We need to avoid createImageBitmap because of
  // https://bugs.chromium.org/p/chromium/issues/detail?id=606319.
  if (file.type.startsWith('image/svg+xml')) {
    const vectorImage = await processSvg(signal, file);
    return { decoded: drawableToImageData(vectorImage), vectorImage };
  }
  return { decoded: await decodeImage(signal, file, workerBridge) };
}

export async function compressImage(
  signal: AbortSignal,
  image: ImageData,
  encodeData: EncoderState,
  sourceFilename: string,
  workerBridge: WorkerBridge,
): Promise<File> {
  assertSignal(signal);

  const encoder = encoderMap[encodeData.type];
  const compressedData = await encoder.encode(
    signal,
    workerBridge,
    image,
    // The type of encodeData.options is enforced via the previous line
    encodeData.options as any,
  );

  // This type ensures the image mimetype is consistent with our mimetype sniffer
  const type: ImageMimeTypes = encoder.meta.mimeType;

  return new File(
    [compressedData],
    replaceExtension(sourceFilename, encoder.meta.extension),
    {
      type,
    },
  );
}

/** Swap a filename's extension, e.g. `photo.png` -> `photo.webp` */
export function replaceExtension(filename: string, extension: string): string {
  return filename.replace(/.[^.]*$/, `.${extension}`);
}
