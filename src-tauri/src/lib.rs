/// MB Viewer desktop shell. All viewer logic lives in the web frontend;
/// native commands (e.g. associating .step files, recent-file lists) can be
/// registered here later via `tauri::Builder::invoke_handler`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running MB Viewer");
}
