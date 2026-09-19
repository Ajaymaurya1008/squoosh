import { h, Component, Fragment } from 'preact';

import * as style from './style.css';
import 'add-css:./style.css';
// The encoder option panels are styled by the editor's options stylesheet.
import 'add-css:../Compress/Options/style.css';

import {
  EncoderOptions,
  EncoderState,
  EncoderType,
  encoderMap,
} from '../feature-meta';
import {
  BatchSettings,
  encoderStateFor,
  loadBatchSettings,
  saveBatchSettings,
} from '../util/prefs';
import {
  WorkerPool,
  defaultConcurrency,
  fitWithin,
  processFile,
} from './engine';
import { createZip, dedupeNames } from '../util/zip';
import prettyBytes from '../Compress/Results/pretty-bytes';
import { DownloadIcon } from '../icons';
import Checkbox from '../Compress/Options/Checkbox';
import type SnackBarElement from 'shared/custom-els/snack-bar';
import { linkRef } from 'shared/prerendered-app/util';

type SupportedEncoderMap = { [P in EncoderType]?: typeof encoderMap[P] };

/** Encoders that pass their feature test in this browser. */
const supportedEncoderMapP: Promise<SupportedEncoderMap> = (async () => {
  const supported: SupportedEncoderMap = { ...encoderMap };

  await Promise.all(
    Object.entries(encoderMap).map(async ([name, details]) => {
      if ('featureTest' in details && !(await details.featureTest())) {
        delete supported[name as EncoderType];
      }
    }),
  );

  return supported;
})();

interface Output {
  /** The settings this output was produced with, so we know when it's stale. */
  signature: string;
  status: 'pending' | 'done' | 'error';
  file?: File;
  url?: string;
  error?: string;
}

interface Item {
  id: number;
  file: File;
  /** Object URL of the source file, used for the thumbnail. */
  sourceUrl: string;
  width?: number;
  height?: number;
  status: 'queued' | 'working' | 'done' | 'error';
  error?: string;
  outputs: { [type: string]: Output };
}

interface Props {
  files: File[];
  showSnack: SnackBarElement['showSnackbar'];
  onBack: () => void;
  onEdit?: (file: File) => void;
  /**
   * Reports the current list of images, including ones added from inside batch
   * mode, so the app shell knows the batch is non-empty and keeps it alive.
   */
  onFilesChange?: (files: File[]) => void;
}

interface State {
  items: Item[];
  settings: BatchSettings;
  supportedEncoderMap?: SupportedEncoderMap;
  /** Which format's advanced options are open, if any. */
  expandedFormat?: EncoderType;
  zipping: boolean;
}

/**
 * Identifies the settings an output was encoded with. If this changes, the
 * output is stale and gets re-encoded.
 */
function outputSignature(
  format: EncoderState,
  settings: BatchSettings,
): string {
  return JSON.stringify([
    format,
    settings.resize.enabled ? settings.resize : null,
  ]);
}

function formatSize(bytes: number): string {
  const { value, unit } = prettyBytes(bytes);
  return `${value} ${unit}`;
}

/** e.g. -72% (a saving), or +4% (a bigger file). */
function formatDelta(from: number, to: number): string {
  if (from === 0) return '';
  const change = Math.round(((to - from) / from) * 100);
  return `${change > 0 ? '+' : ''}${change}%`;
}

function download(blob: Blob | File, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately cancels the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

let nextItemId = 0;

export default class Batch extends Component<Props, State> {
  state: State = {
    items: [],
    settings: loadBatchSettings(),
    zipping: false,
  };

  private pool = new WorkerPool(defaultConcurrency());
  private abortController = new AbortController();
  private runTimeout?: number;
  /** Files already turned into items, so prop updates don't re-add them. */
  private seenFiles = new WeakSet<File>();
  private fileInput?: HTMLInputElement;

  constructor(props: Props) {
    super(props);
    supportedEncoderMapP.then((supportedEncoderMap) => {
      this.setState({ supportedEncoderMap });
    });

    // Seed the initial files directly rather than through addFiles. A setState
    // callback doesn't fire from a constructor, so scheduling the run from
    // here would silently never happen, leaving every image stuck as queued.
    this.state.items = this.itemsFor(props.files);

    // Tell the service worker to cache the codecs, the same way the editor
    // does. Without this, a user who only ever uses batch mode has nothing to
    // encode with when they go offline.
    import('../sw-bridge').then(({ mainAppLoaded }) => mainAppLoaded());
  }

  componentDidMount(): void {
    if (this.state.items.length === 0) return;
    this.notifyFilesChange();
    this.scheduleRun(0);
  }

  componentWillReceiveProps(nextProps: Props): void {
    this.addFiles(nextProps.files);
  }

  componentWillUnmount(): void {
    clearTimeout(this.runTimeout);
    this.abortController.abort();
    for (const item of this.state.items) this.releaseItem(item);
  }

  private releaseItem(item: Item): void {
    URL.revokeObjectURL(item.sourceUrl);
    for (const output of Object.values(item.outputs)) {
      if (output.url) URL.revokeObjectURL(output.url);
    }
  }

  /** Turn files into items, skipping any already in the batch. */
  private itemsFor(files: File[]): Item[] {
    const newFiles = files.filter((file) => file && !this.seenFiles.has(file));
    for (const file of newFiles) this.seenFiles.add(file);

    return newFiles.map((file) => ({
      id: nextItemId++,
      file,
      sourceUrl: URL.createObjectURL(file),
      status: 'queued',
      outputs: {},
    }));
  }

  private addFiles(files: File[]): void {
    const items = this.itemsFor(files);
    if (items.length === 0) return;

    this.setState(
      (state) => ({ items: [...state.items, ...items] }),
      () => {
        this.notifyFilesChange();
        this.scheduleRun(0);
      },
    );
  }

  private notifyFilesChange(): void {
    this.props.onFilesChange?.(this.state.items.map((item) => item.file));
  }

  private onFilesPicked = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    input.value = '';
    this.addFiles(files);
  };

  private onAddClick = () => this.fileInput!.click();

  private onRemoveClick = (id: number) => {
    this.setState(
      (state) => {
        const item = state.items.find((i) => i.id === id);
        if (item) this.releaseItem(item);
        return { items: state.items.filter((i) => i.id !== id) };
      },
      () => this.notifyFilesChange(),
    );
  };

  private onClearClick = () => {
    this.abortController.abort();
    this.abortController = new AbortController();
    this.setState(
      (state) => {
        for (const item of state.items) this.releaseItem(item);
        return { items: [] };
      },
      () => this.notifyFilesChange(),
    );
  };

  private updateItem(id: number, update: (item: Item) => Item): void {
    this.setState((state) => ({
      items: state.items.map((item) => (item.id === id ? update(item) : item)),
    }));
  }

  private updateSettings(settings: BatchSettings): void {
    // Persist straight away, so the choice survives a reload even if the user
    // navigates off before anything finishes encoding.
    saveBatchSettings(settings);
    this.setState({ settings }, () => this.scheduleRun());
  }

  private onFormatToggle = (type: EncoderType) => {
    const { formats } = this.state.settings;
    const selected = formats.some((format) => format.type === type);

    // Always keep at least one output format.
    if (selected && formats.length === 1) return;

    const newFormats = selected
      ? formats.filter((format) => format.type !== type)
      : [...formats, encoderStateFor(type)];

    this.setState({
      expandedFormat: selected ? undefined : type,
    });
    this.updateSettings({ ...this.state.settings, formats: newFormats });
  };

  private onFormatOptionsChange = (
    type: EncoderType,
    options: EncoderOptions,
  ) => {
    this.updateSettings({
      ...this.state.settings,
      formats: this.state.settings.formats.map((format) =>
        format.type === type ? ({ type, options } as EncoderState) : format,
      ),
    });
  };

  private onExpandFormatClick = (type: EncoderType) => {
    this.setState((state) => ({
      expandedFormat: state.expandedFormat === type ? undefined : type,
    }));
  };

  private onResizeEnabledChange = (event: Event) => {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    this.updateSettings({
      ...this.state.settings,
      resize: { ...this.state.settings.resize, enabled },
    });
  };

  private onResizeSizeChange = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const value = Math.round(Number(input.value));
    if (!(value > 0)) return;

    const key = input.name === 'maxWidth' ? 'maxWidth' : 'maxHeight';
    this.updateSettings({
      ...this.state.settings,
      resize: { ...this.state.settings.resize, [key]: value },
    });
  };

  /**
   * Re-run after a short delay, so dragging a quality slider doesn't kick off
   * an encode per pixel of travel.
   */
  private scheduleRun(delay: number = 300): void {
    clearTimeout(this.runTimeout);
    this.runTimeout = setTimeout(() => this.run(), delay) as any;
  }

  /**
   * Bring every item up to date with the current settings.
   *
   * Outputs that already match the settings are kept, so toggling on a new
   * format only encodes that format.
   */
  private run(): void {
    this.abortController.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;
    const { settings } = this.state;
    const tasks: { item: Item; formats: EncoderState[] }[] = [];

    const items = this.state.items.map((item): Item => {
      const outputs: { [type: string]: Output } = {};
      const needed: EncoderState[] = [];

      for (const format of settings.formats) {
        const signature = outputSignature(format, settings);
        const existing = item.outputs[format.type];

        // Only reuse an output that actually finished. A pending one belongs
        // to work this run just aborted, so it has to be encoded again -
        // otherwise nothing is scheduled for it and the item is marked done
        // while its result never arrives.
        if (
          existing &&
          existing.signature === signature &&
          existing.status !== 'pending'
        ) {
          outputs[format.type] = existing;
          continue;
        }

        if (existing?.url) URL.revokeObjectURL(existing.url);
        outputs[format.type] = { signature, status: 'pending' };
        needed.push(format);
      }

      // Release outputs for formats that are no longer selected.
      for (const [type, output] of Object.entries(item.outputs)) {
        if (!(type in outputs) && output.url) URL.revokeObjectURL(output.url);
      }

      const newItem: Item = {
        ...item,
        outputs,
        status: needed.length === 0 ? 'done' : 'queued',
        error: needed.length === 0 ? item.error : undefined,
      };

      if (needed.length > 0) tasks.push({ item: newItem, formats: needed });
      return newItem;
    });

    this.setState({ items });

    for (const { item, formats } of tasks) {
      this.pool
        .run((bridge) => {
          if (signal.aborted) return Promise.resolve();
          this.updateItem(item.id, (current) => ({
            ...current,
            status: 'working',
          }));

          return processFile(
            signal,
            item.file,
            { ...settings, formats },
            bridge,
            {
              onDecoded: ({ width, height }) =>
                this.updateItem(item.id, (current) => ({
                  ...current,
                  width,
                  height,
                })),
              onResult: (type, file) =>
                this.updateItem(item.id, (current) => ({
                  ...current,
                  outputs: {
                    ...current.outputs,
                    [type]: {
                      ...current.outputs[type],
                      status: 'done',
                      file,
                      url: URL.createObjectURL(file),
                    },
                  },
                })),
              onFormatError: (type, error) =>
                this.updateItem(item.id, (current) => ({
                  ...current,
                  outputs: {
                    ...current.outputs,
                    [type]: {
                      ...current.outputs[type],
                      status: 'error',
                      error: error.message,
                    },
                  },
                })),
            },
          );
        })
        .then(
          () => {
            if (signal.aborted) return;
            this.updateItem(item.id, (current) => ({
              ...current,
              status: 'done',
            }));
          },
          (err: Error) => {
            if (err.name === 'AbortError' || signal.aborted) return;
            this.updateItem(item.id, (current) => ({
              ...current,
              status: 'error',
              error: err.message || 'Failed to compress',
            }));
          },
        );
    }
  }

  private onDownloadAllClick = async () => {
    const { items, settings } = this.state;
    const multipleFormats = settings.formats.length > 1;
    const entries: { name: string; blob: Blob }[] = [];

    for (const item of items) {
      for (const format of settings.formats) {
        const output = item.outputs[format.type];
        if (output?.status !== 'done' || !output.file) continue;

        const folder = multipleFormats
          ? `${encoderMap[format.type].meta.extension}/`
          : '';
        entries.push({ name: folder + output.file.name, blob: output.file });
      }
    }

    if (entries.length === 0) {
      this.props.showSnack('Nothing to download yet');
      return;
    }

    const names = dedupeNames(entries.map((entry) => entry.name));

    this.setState({ zipping: true });
    try {
      const zip = await createZip(
        entries.map((entry, i) => ({ name: names[i], blob: entry.blob })),
      );
      download(zip, 'squooshed.zip');
    } catch (err) {
      this.props.showSnack(
        err instanceof Error ? err.message : "Couldn't create zip",
      );
    } finally {
      this.setState({ zipping: false });
    }
  };

  private renderFormatPicker(): h.JSX.Element {
    const { settings, supportedEncoderMap, expandedFormat } = this.state;

    if (!supportedEncoderMap) {
      return <p class={style.settingsHint}>Loading formats…</p>;
    }

    return (
      <Fragment>
        <ul class={style.formatList}>
          {Object.entries(supportedEncoderMap).map(([name, encoder]) => {
            const type = name as EncoderType;
            const selected = settings.formats.some(
              (format) => format.type === type,
            );

            // Something has to be encoded, so the last one standing can't be
            // unticked. Disabling it shows why, rather than ignoring a click.
            const isLastSelected = selected && settings.formats.length === 1;

            return (
              <li key={type}>
                <label
                  class={style.formatOption}
                  title={
                    isLastSelected
                      ? 'Pick another format before turning this one off'
                      : undefined
                  }
                >
                  <Checkbox
                    name={type}
                    checked={selected}
                    disabled={isLastSelected}
                    onChange={() => this.onFormatToggle(type)}
                  />
                  <span class={style.formatName}>{encoder!.meta.label}</span>
                </label>
              </li>
            );
          })}
        </ul>

        {settings.formats.map((format) => {
          const encoder = encoderMap[format.type];
          const OptionsComponent =
            'Options' in encoder ? encoder.Options : undefined;
          if (!OptionsComponent) return null;
          const expanded = expandedFormat === format.type;

          return (
            <div class={style.formatOptions} key={format.type}>
              <button
                type="button"
                class={style.formatOptionsToggle}
                aria-expanded={expanded ? 'true' : 'false'}
                onClick={() => this.onExpandFormatClick(format.type)}
              >
                {encoder.meta.label} settings
                <span class={expanded ? style.chevronOpen : style.chevron}>
                  ▾
                </span>
              </button>
              {expanded && (
                <div class={style.formatOptionsBody}>
                  <OptionsComponent
                    options={format.options as any}
                    onChange={(options: EncoderOptions) =>
                      this.onFormatOptionsChange(format.type, options)
                    }
                  />
                </div>
              )}
            </div>
          );
        })}
      </Fragment>
    );
  }

  private renderItem(item: Item): h.JSX.Element {
    const { settings } = this.state;

    // The size the outputs are actually encoded at, if resizing shrinks it.
    const resized =
      settings.resize.enabled && item.width && item.height
        ? fitWithin(
            item.width,
            item.height,
            settings.resize.maxWidth,
            settings.resize.maxHeight,
          )
        : undefined;

    return (
      <li class={style.item} key={item.id}>
        <div class={style.thumbnail}>
          <img src={item.sourceUrl} alt="" loading="lazy" />
        </div>

        <div class={style.itemInfo}>
          <span class={style.itemName} title={item.file.name}>
            {item.file.name}
          </span>
          <span class={style.itemMeta}>
            {formatSize(item.file.size)}
            {item.width ? ` · ${item.width}×${item.height}` : ''}
            {resized ? ` → ${resized.width}×${resized.height}` : ''}
          </span>
        </div>

        <ul class={style.outputs}>
          {settings.formats.map((format) => {
            const output = item.outputs[format.type];
            const label = encoderMap[format.type].meta.label;

            if (!output || output.status === 'pending') {
              // A decode failure fails the whole item, so its formats never
              // got as far as reporting an error of their own.
              const failed = item.status === 'error';

              return (
                <li
                  class={failed ? style.outputError : style.outputPending}
                  key={format.type}
                >
                  <span class={style.outputLabel}>{label}</span>
                  <span class={style.outputValue}>
                    {failed
                      ? 'Skipped'
                      : item.status === 'queued'
                      ? 'Queued'
                      : 'Working…'}
                  </span>
                </li>
              );
            }

            if (output.status === 'error') {
              return (
                <li class={style.outputError} key={format.type}>
                  <span class={style.outputLabel}>{label}</span>
                  <span class={style.outputValue}>
                    {output.error || 'Failed'}
                  </span>
                </li>
              );
            }

            const size = output.file!.size;
            const smaller = size < item.file.size;

            return (
              <li class={style.output} key={format.type}>
                <span class={style.outputLabel}>{label}</span>
                <span class={style.outputValue}>
                  {formatSize(size)}
                  <span class={smaller ? style.saving : style.increase}>
                    {formatDelta(item.file.size, size)}
                  </span>
                </span>
                <a
                  class={style.outputDownload}
                  href={output.url}
                  download={output.file!.name}
                  title={`Download ${output.file!.name}`}
                >
                  <DownloadIcon />
                </a>
              </li>
            );
          })}
        </ul>

        <div class={style.itemActions}>
          {item.status === 'error' && (
            <span class={style.itemError}>{item.error}</span>
          )}
          {this.props.onEdit && (
            <button
              type="button"
              class={style.itemAction}
              onClick={() => this.props.onEdit!(item.file)}
              title="Open in the editor"
            >
              Edit
            </button>
          )}
          <button
            type="button"
            class={style.itemAction}
            onClick={() => this.onRemoveClick(item.id)}
            title="Remove"
          >
            Remove
          </button>
        </div>
      </li>
    );
  }

  private renderSummary(): h.JSX.Element | null {
    const { items, settings } = this.state;
    if (items.length === 0) return null;

    const originalTotal = items.reduce(
      (total, item) => total + item.file.size,
      0,
    );

    return (
      <div class={style.summary}>
        <div class={style.summaryTotal}>
          <strong>{items.length}</strong>{' '}
          {items.length === 1 ? 'image' : 'images'} ·{' '}
          {formatSize(originalTotal)} original
        </div>
        <ul class={style.summaryFormats}>
          {settings.formats.map((format) => {
            const done = items.filter(
              (item) => item.outputs[format.type]?.status === 'done',
            );
            const outputTotal = done.reduce(
              (total, item) => total + item.outputs[format.type].file!.size,
              0,
            );
            const sourceTotal = done.reduce(
              (total, item) => total + item.file.size,
              0,
            );

            return (
              <li key={format.type}>
                <span class={style.summaryLabel}>
                  {encoderMap[format.type].meta.label}
                </span>
                {done.length === items.length ? (
                  <span>
                    {formatSize(outputTotal)}{' '}
                    <span
                      class={
                        outputTotal < sourceTotal
                          ? style.saving
                          : style.increase
                      }
                    >
                      {formatDelta(sourceTotal, outputTotal)}
                    </span>
                  </span>
                ) : (
                  <span class={style.summaryProgress}>
                    {done.length}/{items.length} done
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  render(_: Props, { items, settings, zipping }: State) {
    const anyDone = items.some((item) =>
      settings.formats.some(
        (format) => item.outputs[format.type]?.status === 'done',
      ),
    );

    // While images are still encoding, say so on the download button rather
    // than leaving it disabled with no explanation.
    const finished = items.filter(
      (item) => item.status === 'done' || item.status === 'error',
    ).length;
    const compressing = items.length > 0 && finished < items.length;

    let downloadLabel = 'Download all';
    if (zipping) downloadLabel = 'Zipping…';
    else if (compressing) {
      downloadLabel = `Compressing ${finished}/${items.length}…`;
    }

    return (
      <div class={style.batch}>
        <input
          class={style.hide}
          type="file"
          multiple
          accept="image/*"
          ref={linkRef(this, 'fileInput')}
          onChange={this.onFilesPicked}
        />

        <header class={style.header}>
          <button
            type="button"
            class={style.backButton}
            onClick={this.props.onBack}
            title="Back"
          >
            ←
          </button>
          <h1 class={style.title}>Batch compress</h1>
          <div class={style.headerActions}>
            <button
              type="button"
              class={style.secondaryButton}
              onClick={this.onAddClick}
            >
              Add images
            </button>
            <button
              type="button"
              class={style.primaryButton}
              onClick={this.onDownloadAllClick}
              disabled={!anyDone || zipping || compressing}
              aria-busy={zipping || compressing ? 'true' : 'false'}
            >
              {(zipping || compressing) && (
                <span class={style.buttonSpinner} aria-hidden="true" />
              )}
              {downloadLabel}
            </button>
          </div>
        </header>

        <div class={style.body}>
          <section class={style.settings}>
            <h2 class={style.sectionTitle}>Convert to</h2>
            <p class={style.settingsHint}>
              Pick one or more formats. Your choice is remembered for next time.
            </p>
            {this.renderFormatPicker()}

            <h2 class={style.sectionTitle}>Resize</h2>
            <label class={style.resizeToggle}>
              <Checkbox
                name="resize"
                checked={settings.resize.enabled}
                onChange={this.onResizeEnabledChange}
              />
              Shrink images to fit a maximum size
            </label>
            {settings.resize.enabled && (
              <div class={style.resizeFields}>
                <label>
                  Max width
                  <input
                    type="number"
                    name="maxWidth"
                    min="1"
                    value={settings.resize.maxWidth}
                    onChange={this.onResizeSizeChange}
                  />
                </label>
                <label>
                  Max height
                  <input
                    type="number"
                    name="maxHeight"
                    min="1"
                    value={settings.resize.maxHeight}
                    onChange={this.onResizeSizeChange}
                  />
                </label>
              </div>
            )}
          </section>

          <section class={style.results}>
            {this.renderSummary()}

            {items.length === 0 ? (
              <div class={style.empty}>
                <p>Drop images anywhere, or</p>
                <button
                  type="button"
                  class={style.primaryButton}
                  onClick={this.onAddClick}
                >
                  Select images
                </button>
              </div>
            ) : (
              <Fragment>
                <ul class={style.items}>
                  {items.map((item) => this.renderItem(item))}
                </ul>
                <button
                  type="button"
                  class={style.clearButton}
                  onClick={this.onClearClick}
                >
                  Clear all
                </button>
              </Fragment>
            )}
          </section>
        </div>
      </div>
    );
  }
}
