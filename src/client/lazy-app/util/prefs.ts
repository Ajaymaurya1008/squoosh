/**
 * Persisted user preferences.
 *
 * Everything here is best-effort: localStorage throws in Safari's private mode
 * and when storage is full, and anything already stored may be from an older
 * version of the app, so reads are validated and failures fall back to
 * defaults rather than breaking the page.
 */
import {
  EncoderState,
  EncoderType,
  encoderMap,
  EncoderOptions,
} from '../feature-meta';

const BATCH_SETTINGS_KEY = 'squoosh:batch-settings';
const PREFERRED_ENCODER_KEY = 'squoosh:preferred-encoder';
const SETTINGS_VERSION = 1;

export interface BatchResizeSettings {
  enabled: boolean;
  /** Images larger than this are scaled down, preserving aspect ratio. */
  maxWidth: number;
  maxHeight: number;
}

export interface BatchSettings {
  /** The output formats to encode every image to. Never empty. */
  formats: EncoderState[];
  resize: BatchResizeSettings;
}

export function isEncoderType(type: unknown): type is EncoderType {
  return typeof type === 'string' && type in encoderMap;
}

export function encoderStateFor(type: EncoderType): EncoderState {
  return {
    type,
    options: encoderMap[type].meta.defaultOptions,
  } as EncoderState;
}

export function defaultBatchSettings(): BatchSettings {
  const preferred = getPreferredEncoderType();
  return {
    formats: [encoderStateFor(preferred || 'mozJPEG')],
    resize: { enabled: false, maxWidth: 2000, maxHeight: 2000 },
  };
}

function readItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    return null;
  }
}

function writeItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    // Storage is unavailable or full. Preferences just won't stick.
  }
}

/**
 * The format the user picked last, used as the default selection everywhere.
 */
export function getPreferredEncoderType(): EncoderType | undefined {
  const stored = readItem(PREFERRED_ENCODER_KEY);
  return isEncoderType(stored) ? stored : undefined;
}

export function setPreferredEncoderType(type: EncoderType): void {
  writeItem(PREFERRED_ENCODER_KEY, type);
}

/**
 * Restore a stored encoder state, dropping formats this build no longer has,
 * and filling in options added since it was stored.
 */
function reviveFormat(value: any): EncoderState | undefined {
  const type: unknown = value?.type;
  if (!isEncoderType(type)) return undefined;

  const defaults = encoderMap[type].meta.defaultOptions;
  const options =
    value.options && typeof value.options === 'object'
      ? ({ ...defaults, ...value.options } as EncoderOptions)
      : defaults;

  return { type, options } as EncoderState;
}

function reviveResize(value: any): BatchResizeSettings {
  const fallback = { enabled: false, maxWidth: 2000, maxHeight: 2000 };
  if (!value || typeof value !== 'object') return fallback;

  const maxWidth = Number(value.maxWidth);
  const maxHeight = Number(value.maxHeight);

  return {
    enabled: !!value.enabled,
    maxWidth: maxWidth > 0 ? Math.round(maxWidth) : fallback.maxWidth,
    maxHeight: maxHeight > 0 ? Math.round(maxHeight) : fallback.maxHeight,
  };
}

export function loadBatchSettings(): BatchSettings {
  const stored = readItem(BATCH_SETTINGS_KEY);
  if (!stored) return defaultBatchSettings();

  try {
    const parsed = JSON.parse(stored);
    if (!parsed || parsed.version !== SETTINGS_VERSION) {
      return defaultBatchSettings();
    }

    const formats = (Array.isArray(parsed.formats) ? parsed.formats : []).map(
      reviveFormat,
    );

    // De-duplicate, and drop anything that didn't survive revival.
    const seen = new Set<EncoderType>();
    const validFormats: EncoderState[] = [];
    for (const format of formats) {
      if (!format || seen.has(format.type)) continue;
      seen.add(format.type);
      validFormats.push(format);
    }

    if (validFormats.length === 0) return defaultBatchSettings();

    return { formats: validFormats, resize: reviveResize(parsed.resize) };
  } catch (err) {
    return defaultBatchSettings();
  }
}

export function saveBatchSettings(settings: BatchSettings): void {
  writeItem(
    BATCH_SETTINGS_KEY,
    JSON.stringify({ version: SETTINGS_VERSION, ...settings }),
  );

  // Keep the single-image editor's default in sync with the batch selection.
  if (settings.formats.length > 0) {
    setPreferredEncoderType(settings.formats[0].type);
  }
}
