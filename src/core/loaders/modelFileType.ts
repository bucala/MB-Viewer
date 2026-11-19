const STEP_HEADER = /^\s*ISO-10303-21\s*;/;

export function resolveModelExtension(fileName: string, buffer: ArrayBuffer): string {
  const extension = /\.([^./\\]+)$/.exec(fileName)?.[1].toLowerCase() ?? '';
  if (extension && extension !== 'bin') return extension;

  // Android document providers can replace the original extension with .bin
  // or omit it. Inspect only the header so large STEP files aren't decoded twice.
  const header = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 512)));
  return STEP_HEADER.test(header) ? 'stp' : extension;
}
