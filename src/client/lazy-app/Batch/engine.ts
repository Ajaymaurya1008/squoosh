/**
 * The batch compression engine: a small worker pool, plus the per-image
 * pipeline of decode -> optional resize -> encode to each selected format.
 */
import WorkerBridge from '../worker-bridge';
import { compressImage, decodeFile, SourceImage } from '../util/image-pipeline';
import { assertSignal } from '../util';
import { resize } from 'features/processors/resize/client';
import type { Options as ResizeOptions } from 'features/processors/resize/shared/meta';
import type { BatchSettings } from '../util/prefs';
import type { EncoderType } from '../feature-meta';

/** Sensible default for how many images to work on at once. */
export function defaultConcurrency(): number {
  // Each lane holds a wasm worker, so this trades memory for throughput.
  return Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
}

interface Lane {
  bridge: WorkerBridge;
  busy: boolean;
}

interface QueueItem {
  task: (bridge: WorkerBridge) => Promise<unknown>;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}

/**
 * Runs tasks across a fixed number of lanes, each with its own worker.
 *
 * A `WorkerBridge` already serialises the calls made through it, so one lane
 * is one image at a time.
 */
export class WorkerPool {
  private lanes: Lane[];
  private queue: QueueItem[] = [];

  constructor(size: number) {
    this.lanes = Array.from({ length: size }, () => ({
      bridge: new WorkerBridge(),
      busy: false,
    }));
  }

  run<T>(task: (bridge: WorkerBridge) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    for (const lane of this.lanes) {
      if (lane.busy || this.queue.length === 0) continue;

      const item = this.queue.shift()!;
      lane.busy = true;

      item
        .task(lane.bridge)
        .then(item.resolve, item.reject)
        .then(() => {
          lane.busy = false;
          this.pump();
        });
    }
  }
}

/**
 * Scale `width`/`height` down to fit inside the given box, preserving aspect
 * ratio. Returns undefined if the image already fits.
 */
export function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } | undefined {
  const scale = Math.min(maxWidth / width, maxHeight / height);
  if (scale >= 1) return undefined;

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface DecodedInfo {
  width: number;
  height: number;
}

export interface ProcessHandlers {
  /** Called once the source image's dimensions are known. */
  onDecoded?(info: DecodedInfo): void;
  onResult(type: EncoderType, file: File): void;
  onFormatError(type: EncoderType, error: Error): void;
}

/**
 * Decode one image and encode it to every selected format.
 *
 * A failure in one format doesn't stop the others; it's reported through
 * `onFormatError`. Anything that goes wrong before encoding (an undecodable
 * file) rejects, as none of the formats can be produced.
 */
export async function processFile(
  signal: AbortSignal,
  file: File,
  settings: BatchSettings,
  bridge: WorkerBridge,
  handlers: ProcessHandlers,
): Promise<void> {
  assertSignal(signal);

  const { decoded, vectorImage } = await decodeFile(signal, file, bridge);
  handlers.onDecoded?.({ width: decoded.width, height: decoded.height });

  const source: SourceImage = {
    file,
    decoded,
    preprocessed: decoded,
    vectorImage,
  };

  let image = decoded;

  if (settings.resize.enabled) {
    const target = fitWithin(
      decoded.width,
      decoded.height,
      settings.resize.maxWidth,
      settings.resize.maxHeight,
    );

    if (target) {
      const options = {
        ...target,
        fitMethod: 'stretch',
        ...(vectorImage
          ? { method: 'vector' }
          : { method: 'lanczos3', premultiply: true, linearRGB: true }),
      } as ResizeOptions;

      image = await resize(signal, source, options, bridge);
    }
  }

  for (const format of settings.formats) {
    assertSignal(signal);
    try {
      handlers.onResult(
        format.type,
        await compressImage(signal, image, format, file.name, bridge),
      );
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      handlers.onFormatError(
        format.type,
        err instanceof Error ? err : Error('Encoding failed'),
      );
    }
  }
}
