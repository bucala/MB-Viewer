import { useViewer } from '@/store/viewerStore';
import { buildModelFromCad, parseCadInWorker, type CadFormat } from '@/core/loaders/occtLoader';
import { loadGlbModel, loadObjModel, loadStlModel } from '@/core/loaders/meshLoaders';
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
  const store = useViewer.getState();
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  store.beginLoad(file.name);

  try {
    let model: LoadedModel;
    if (extension in CAD_FORMATS) {
      // B-rep formats: tessellated by OpenCASCADE (WASM) in a Web Worker.
      const result = await parseCadInWorker(await file.arrayBuffer(), CAD_FORMATS[extension]);
      model = buildModelFromCad(file.name, result);
    } else if (extension === 'stl') {
      model = loadStlModel(await file.arrayBuffer(), file.name);
    } else if (extension === 'obj') {
      model = loadObjModel(await file.text(), file.name);
    } else if (extension === 'glb') {
      model = await loadGlbModel(await file.arrayBuffer(), file.name);
    } else {
      throw new Error(
        `Unsupported file type ".${extension}". Supported: ${ACCEPTED_EXTENSIONS.join(', ')}.`,
      );
    }
    useViewer.getState().setModel(model);
  } catch (error) {
    useViewer.getState().failLoad(error instanceof Error ? error.message : String(error));
  }
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
