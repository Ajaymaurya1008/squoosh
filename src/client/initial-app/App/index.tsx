import type { FileDropEvent } from 'file-drop-element';
import type SnackBarElement from 'shared/custom-els/snack-bar';
import type { SnackOptions } from 'shared/custom-els/snack-bar';

import { h, Component, Fragment } from 'preact';

import { linkRef } from 'shared/prerendered-app/util';
import * as style from './style.css';
import 'add-css:./style.css';
import 'file-drop-element';
import 'shared/custom-els/snack-bar';
import Intro from 'shared/prerendered-app/Intro';
import 'shared/custom-els/loading-spinner';

const ROUTE_EDITOR = '/editor';
const ROUTE_BATCH = '/batch';

const compressPromise = import('client/lazy-app/Compress');
const batchPromise = import('client/lazy-app/Batch');
const swBridgePromise = import('client/lazy-app/sw-bridge');

function back() {
  window.history.back();
}

interface Props {}

interface State {
  awaitingShareTarget: boolean;
  file?: File;
  /** Files handed to the batch compressor. */
  batchFiles: File[];
  isEditorOpen: boolean;
  isBatchOpen: boolean;
  Compress?: typeof import('client/lazy-app/Compress').default;
  Batch?: typeof import('client/lazy-app/Batch').default;
}

export default class App extends Component<Props, State> {
  state: State = {
    awaitingShareTarget: new URL(location.href).searchParams.has(
      'share-target',
    ),
    isEditorOpen: false,
    isBatchOpen: false,
    file: undefined,
    batchFiles: [],
    Compress: undefined,
    Batch: undefined,
  };

  snackbar?: SnackBarElement;

  constructor() {
    super();

    compressPromise
      .then((module) => {
        this.setState({ Compress: module.default });
      })
      .catch(() => {
        this.showSnack('Failed to load app');
      });

    batchPromise
      .then((module) => {
        this.setState({ Batch: module.default });
      })
      .catch(() => {
        this.showSnack('Failed to load batch mode');
      });

    swBridgePromise.then(async ({ offliner, getSharedImage }) => {
      offliner(this.showSnack);
      if (!this.state.awaitingShareTarget) return;
      const file = await getSharedImage();
      // Remove the ?share-target from the URL
      history.replaceState('', '', '/');
      this.openEditor();
      this.setState({ file, awaitingShareTarget: false });
    });

    // Since iOS 10, Apple tries to prevent disabling pinch-zoom. This is great in theory, but
    // really breaks things on Squoosh, as you can easily end up zooming the UI when you mean to
    // zoom the image. Once you've done this, it's really difficult to undo. Anyway, this seems to
    // prevent it.
    document.body.addEventListener('gesturestart', (event: any) => {
      event.preventDefault();
    });

    window.addEventListener('popstate', this.onPopState);
  }

  private onFileDrop = ({ files }: FileDropEvent) => {
    if (!files || files.length === 0) return;
    // Several images at once, or images added to an open batch, go to batch
    // mode. A lone image opens in the editor, as it always has.
    if (files.length > 1 || this.state.isBatchOpen) {
      this.openBatch(Array.from(files));
      return;
    }
    this.openEditor();
    this.setState({ file: files[0] });
  };

  private onIntroPickFile = (file: File) => {
    this.openEditor();
    this.setState({ file });
  };

  private onIntroPickFiles = (files: File[]) => {
    if (files.length === 0) return;
    if (files.length === 1) {
      this.onIntroPickFile(files[0]);
      return;
    }
    this.openBatch(files);
  };

  private onBatchFilesChange = (files: File[]) => {
    this.setState({ batchFiles: files });
  };

  private onEditFromBatch = (file: File) => {
    this.openEditor();
    this.setState({ file });
  };

  private showSnack = (
    message: string,
    options: SnackOptions = {},
  ): Promise<string> => {
    if (!this.snackbar) throw Error('Snackbar missing');
    return this.snackbar.showSnackbar(message, options);
  };

  private onPopState = () => {
    this.setState({
      isEditorOpen: location.pathname === ROUTE_EDITOR,
      isBatchOpen: location.pathname === ROUTE_BATCH,
    });
  };

  private navigate(pathname: string): void {
    // Change path, but preserve query string.
    const url = new URL(location.href);
    url.pathname = pathname;
    history.pushState(null, '', url.href);
  }

  private openEditor = () => {
    if (this.state.isEditorOpen) return;
    this.navigate(ROUTE_EDITOR);
    this.setState({ isEditorOpen: true, isBatchOpen: false });
  };

  private openBatch = (files: File[] = []) => {
    if (!this.state.isBatchOpen) this.navigate(ROUTE_BATCH);
    this.setState((state) => ({
      isBatchOpen: true,
      isEditorOpen: false,
      batchFiles:
        files.length === 0 ? state.batchFiles : [...state.batchFiles, ...files],
    }));
  };

  render(
    {}: Props,
    {
      file,
      batchFiles,
      isEditorOpen,
      isBatchOpen,
      Compress,
      Batch,
      awaitingShareTarget,
    }: State,
  ) {
    const BatchView = Batch!;

    const showSpinner =
      awaitingShareTarget ||
      (isEditorOpen && !Compress) ||
      (isBatchOpen && !Batch);

    // Batch mode is rendered in one place and merely hidden when another view
    // is on top, so opening one image in the editor doesn't throw away the
    // rest of the batch's results.
    const batchMounted = !!Batch && (isBatchOpen || batchFiles.length > 0);

    return (
      <div class={style.app}>
        <file-drop onfiledrop={this.onFileDrop} class={style.drop}>
          {showSpinner ? (
            <loading-spinner class={style.appLoader} />
          ) : (
            <Fragment>
              {batchMounted && (
                <div class={isBatchOpen ? style.view : style.offscreen}>
                  <BatchView
                    files={batchFiles}
                    showSnack={this.showSnack}
                    onBack={back}
                    onEdit={this.onEditFromBatch}
                    onFilesChange={this.onBatchFilesChange}
                  />
                </div>
              )}
              {!isBatchOpen &&
                (isEditorOpen ? (
                  Compress && (
                    <Compress
                      file={file!}
                      showSnack={this.showSnack}
                      onBack={back}
                    />
                  )
                ) : (
                  <Intro
                    onFile={this.onIntroPickFile}
                    onFiles={this.onIntroPickFiles}
                    onBatch={this.openBatch}
                    showSnack={this.showSnack}
                  />
                ))}
            </Fragment>
          )}
          <snack-bar ref={linkRef(this, 'snackbar')} />
        </file-drop>
      </div>
    );
  }
}
