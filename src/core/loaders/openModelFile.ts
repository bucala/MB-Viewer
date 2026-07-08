import { useViewer } from '@/store/viewerStore';
import { buildModelFromCad, parseCadInWorker, type CadFormat } from '@/core/loaders/occtLoader';
import { loadGlbModel, loadObjModel, loadStlModel } from '@/core/loaders/meshLoaders';
import { tr } from '@/i18n';
import type { LoadedModel } from '@/core/types';

export const ACCEPTED_EXTENSIONS = ['step', 'stp', 'iges', 'igs', 'brep', 'stl', 'obj', 'glb'];
export const FILE_ACCEPT = ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(',');

const CAD_FORMATS: Record<string, CadFormat> = {
  step: 'step', stp: 'step',
  iges: 'iges', igs: 'iges',
  brep: 'brep',
};

/** Route a picked/dropped file to the right parser and publish the result. */
export async function openModelFile(file: File): Promise<void> {
  return openModelBuffer(await file.arrayBuffer(), file.name);
}

/**
 * Same, from raw bytes — used by the desktop shell when a file arrives via
 * an OS file association (double-click in Explorer) instead of the picker.
 */
export async function openModelBuffer(buffer: ArrayBuffer, fileName: string): Promise<void> {
  const store = useViewer.getState();
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  store.beginLoad(fileName);

  try {
    let model: LoadedModel;
    if (extension in CAD_FORMATS) {
      // B-rep formats: tessellated by OpenCASCADE (WASM) in a Web Worker.
      const result = await parseCadInWorker(buffer, CAD_FORMATS[extension]);
      model = buildModelFromCad(fileName, result);
    } else if (extension === 'stl') {
      model = loadStlModel(buffer, fileName);
    } else if (extension === 'obj') {
      model = loadObjModel(new TextDecoder().decode(buffer), fileName);
    } else if (extension === 'glb') {
      model = await loadGlbModel(buffer, fileName);
    } else {
      throw new Error(tr('err.unsupported', { ext: extension, list: ACCEPTED_EXTENSIONS.join(', ') }));
    }
    useViewer.getState().setModel(model);
  } catch (error) {
    useViewer.getState().failLoad(localizeError(error));
  }
}

/** Map known worker/engine messages to the active language. */
function localizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('OpenCASCADE could not parse')) return tr('err.occt');
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
