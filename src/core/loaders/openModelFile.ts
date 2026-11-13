import { useViewer } from '@/store/viewerStore';
import { buildModelFromCad, parseCadInWorker, type CadFormat } from '@/core/loaders/occtLoader';
import { loadGlbModel, loadObjModel, loadStlModel } from '@/core/loaders/meshLoaders';
import { useSettings } from '@/store/settingsStore';
import { disposeModel } from '@/core/loaders/finalizeModel';
import { tr } from '@/i18n';
import type { LoadedModel } from '@/core/types';

export const ACCEPTED_EXTENSIONS = ['step', 'stp', 'iges', 'igs', 'brep', 'stl', 'obj', 'glb'];
export const FILE_ACCEPT = ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(',');

let currentLoad: AbortController | null = null;

const CAD_FORMATS: Record<string, CadFormat> = {
  step: 'step', stp: 'step',
  iges: 'iges', igs: 'iges',
  brep: 'brep',
};

/** Route a picked/dropped file to the right parser and publish the result. */
export async function openModelFile(file: File): Promise<void> {
  // The load starts (and supersedes the previous one) when the user drops
  // the file, not when its bytes have been read — reading a big file can
  // take longer than reading a small one dropped right after it.
  const controller = startLoad(file.name);
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (error) {
    if (!controller.signal.aborted) useViewer.getState().failLoad(localizeError(error));
    return;
  }
  if (!controller.signal.aborted) await loadBuffer(buffer, file.name, controller);
}

/**
 * Same, from raw bytes — used by the desktop shell when a file arrives via
 * an OS file association (double-click in Explorer) instead of the picker.
 */
export async function openModelBuffer(buffer: ArrayBuffer, fileName: string): Promise<void> {
  await loadBuffer(buffer, fileName, startLoad(fileName));
}

/** Supersede (abort) the load still running and announce a new one. */
function startLoad(fileName: string): AbortController {
  currentLoad?.abort(new DOMException('Superseded by a newer file', 'AbortError'));
  const controller = new AbortController();
  currentLoad = controller;
  useViewer.getState().beginLoad(fileName);
  return controller;
}

async function loadBuffer(buffer: ArrayBuffer, fileName: string, controller: AbortController): Promise<void> {
  const { signal } = controller;
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';

  try {
    let model: LoadedModel;
    if (extension in CAD_FORMATS) {
      // B-rep formats: tessellated by OpenCASCADE (WASM) in a Web Worker.
      const quality = useSettings.getState().tessellation;
      const result = await parseCadInWorker(buffer, CAD_FORMATS[extension], { quality, signal });
      model = await buildModelFromCad(fileName, result, signal);
    } else if (extension === 'stl') {
      model = await loadStlModel(buffer, fileName, signal);
    } else if (extension === 'obj') {
      model = await loadObjModel(buffer, fileName, signal);
    } else if (extension === 'glb') {
      model = await loadGlbModel(buffer, fileName, signal);
    } else {
      throw new Error(tr('err.unsupported', { ext: extension, list: ACCEPTED_EXTENSIONS.join(', ') }));
    }
    if (signal.aborted) {
      disposeModel(model, false);
      return;
    }
    useViewer.getState().setModel(model);
  } catch (error) {
    if (signal.aborted) return;
    useViewer.getState().failLoad(localizeError(error));
  } finally {
    if (currentLoad === controller) currentLoad = null;
  }
}

/** Abandon the load in progress (Cancel button on the loading overlay). */
export function cancelModelLoad(): void {
  if (!currentLoad) return;
  currentLoad.abort(new DOMException('Cancelled by the user', 'AbortError'));
  currentLoad = null;
  useViewer.getState().dismissError();
}

/** Map known worker/engine messages to the active language. */
function localizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('OpenCASCADE could not parse')) return tr('err.occt');
  if (message === 'The CAD file contains no triangle geometry.') return tr('err.cadEmpty');
  if (message.includes('worker crashed')) return tr('err.worker');
  return message;
}

/** Programmatic file picker, usable from any component without a hidden input. */
export function pickModelFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = FILE_ACCEPT;
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void openModelFile(file);
  };
  input.click();
}
