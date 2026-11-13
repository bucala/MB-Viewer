//! MB Viewer desktop shell. All viewer logic lives in the web frontend; the
//! shell contributes what the browser cannot do: opening files passed by the
//! OS (double-clicked associated files) and registering file associations at
//! runtime.

mod associations;

use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;

use associations::AssociationChoice;
use tauri::State;

/// Model files the process was launched with, waiting for the webview to
/// pick them up once the frontend is ready.
struct LaunchFiles(Mutex<Vec<String>>);

/// Paths the OS handed us (launch arguments, files forwarded by a second
/// instance). `read_model_file` reads only these, so the webview cannot be
/// used to read arbitrary files from disk.
struct OpenableFiles(Mutex<HashSet<String>>);

impl OpenableFiles {
    fn allow(&self, paths: &[String]) {
        self.0.lock().unwrap().extend(paths.iter().cloned());
    }
}

/// Keep only arguments that point at an existing, openable model file.
fn model_file_args<I: IntoIterator<Item = String>>(args: I) -> Vec<String> {
    args.into_iter()
        .filter(|arg| !arg.starts_with('-'))
        .filter(|arg| {
            let path = Path::new(arg);
            path.is_file()
                && path
                    .extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(associations::is_supported_extension)
        })
        .collect()
}

/// Hand the launch files to the frontend (drains — subsequent calls are empty).
#[tauri::command]
fn take_launch_files(state: State<'_, LaunchFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

/// Read a model file as raw bytes (an IPC raw response, not JSON), so the
/// frontend can feed it through the same loaders as picked/dropped files.
#[tauri::command]
fn read_model_file(
    path: String,
    openable: State<'_, OpenableFiles>,
) -> Result<tauri::ipc::Response, String> {
    if !openable.0.lock().unwrap().contains(&path) {
        return Err(format!("not a file opened through the OS: {path}"));
    }
    let file = Path::new(&path);
    let supported = file
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(associations::is_supported_extension);
    if !supported {
        return Err(format!("not a supported model file: {path}"));
    }
    std::fs::read(file)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("could not read {path}: {e}"))
}

/// Apply the Settings → File associations choices to the OS (Windows: HKCU
/// registry + Explorer refresh). Returns false where unsupported (web/mobile).
#[tauri::command]
fn apply_file_associations(choices: Vec<AssociationChoice>) -> Result<bool, String> {
    associations::apply(&choices)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Route files double-clicked while the app is already running into the
    // existing window instead of spawning a second instance.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        use tauri::{Emitter, Manager};
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_focus();
        }
        let files = model_file_args(args.into_iter().skip(1));
        if !files.is_empty() {
            app.state::<OpenableFiles>().allow(&files);
            let _ = app.emit("mb-viewer://open-files", files);
        }
    }));

    let launch_files = model_file_args(std::env::args().skip(1));
    let openable = OpenableFiles(Mutex::new(launch_files.iter().cloned().collect()));

    builder
        .manage(LaunchFiles(Mutex::new(launch_files)))
        .manage(openable)
        .invoke_handler(tauri::generate_handler![
            take_launch_files,
            read_model_file,
            apply_file_associations
        ])
        .run(tauri::generate_context!())
        .expect("error while running MB Viewer");
}
