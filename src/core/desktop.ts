import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ACCEPTED_EXTENSIONS, openModelBuffer } from '@/core/loaders/openModelFile';

/**
 * Glue to the Tauri desktop shell. Every entry point is a no-op on the web
 * and Android builds, so callers never need to branch on the platform.
 */
export function isDesktopShell(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function openModelPath(path: string): Promise<void> {
  const name = path.split(/[\\/]/).pop() ?? path;
  // Raw-body IPC response — the bytes are not JSON-serialized.
  const data = await invoke<ArrayBuffer>('read_model_file', { path });
  await openModelBuffer(data, name);
}

/**
 * Open the file the app was launched with (a double-clicked associated file
 * passes it as a CLI argument) and keep listening for files forwarded by
 * later launches (the single-instance plugin re-routes them here).
 */
export function initDesktopIntegration(): void {
  if (!isDesktopShell()) return;

  void invoke<string[]>('take_launch_files')
    .then((paths) => (paths[0] ? openModelPath(paths[0]) : undefined))
    .catch((error) => console.error('[desktop] launch file failed:', error));

  void listen<string[]>('mb-viewer://open-files', (event) => {
    if (event.payload[0]) {
      void openModelPath(event.payload[0]).catch((error) =>
        console.error('[desktop] forwarded file failed:', error),
      );
    }
  });
}

/**
 * Register/unregister the OS file associations for the current user.
 * Resolves to true when the desktop shell actually applied them, false when
 * running in a browser/Android (nothing to do there).
 */
export async function applyFileAssociations(
  fileAssociations: Record<string, boolean>,
): Promise<boolean> {
  if (!isDesktopShell()) return false;
  // Always send every supported extension with its current on/off state, so a
  // freshly opened Settings panel applies immediately and unchecked types get
  // unregistered rather than silently skipped.
  const choices = ACCEPTED_EXTENSIONS.map((ext) => ({
    ext,
    enabled: Boolean(fileAssociations[ext]),
  }));
  return invoke<boolean>('apply_file_associations', { choices });
}
