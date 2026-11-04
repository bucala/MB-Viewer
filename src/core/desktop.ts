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
 * Register/unregister OS file associations for the current user — only the
 * extensions passed in `changes`. Unregistering touches the user's default-app
 * choices, so callers must pass just what the user actually toggled.
 * Resolves to true when the desktop shell applied them, false in a
 * browser/Android or when there was nothing to apply.
 */
export async function applyFileAssociations(changes: Record<string, boolean>): Promise<boolean> {
  if (!isDesktopShell()) return false;
  const choices = Object.entries(changes)
    .filter(([ext]) => ACCEPTED_EXTENSIONS.includes(ext))
    .map(([ext, enabled]) => ({ ext, enabled }));
  if (choices.length === 0) return false;
  return invoke<boolean>('apply_file_associations', { choices });
}

/** Extensions whose association choice differs between two settings states. */
export function changedAssociations(
  previous: Record<string, boolean>,
  next: Record<string, boolean>,
): Record<string, boolean> {
  const changes: Record<string, boolean> = {};
  for (const ext of ACCEPTED_EXTENSIONS) {
    if (Boolean(previous[ext]) !== Boolean(next[ext])) changes[ext] = Boolean(next[ext]);
  }
  return changes;
}
