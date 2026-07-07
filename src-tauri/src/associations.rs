//! Runtime registration of OS file associations.
//!
//! The MSI installer registers the associations machine-wide; this module
//! lets the running app apply the user's Settings choices immediately, by
//! writing per-user ProgIDs under `HKCU\Software\Classes` — no reinstall.
//!
//! Windows Explorer thumbnails: when an extension already has an
//! `IThumbnailProvider` (e.g. 3D Viewer renders .stl previews), taking over
//! the association with a ProgID that lacks one makes every file fall back
//! to a blank icon. To keep thumbnails working, the previous provider's
//! CLSID is copied onto the MB Viewer ProgID.

use serde::Deserialize;

#[derive(Deserialize)]
pub struct AssociationChoice {
    pub ext: String,
    pub enabled: bool,
}

/// Extensions the viewer can open; anything else is rejected up front.
pub const SUPPORTED_EXTENSIONS: [&str; 8] =
    ["step", "stp", "iges", "igs", "brep", "stl", "obj", "glb"];

pub fn is_supported_extension(ext: &str) -> bool {
    SUPPORTED_EXTENSIONS.iter().any(|e| ext.eq_ignore_ascii_case(e))
}

/// Apply the choices. Returns `true` when associations were written (Windows),
/// `false` on platforms where runtime registration is not implemented.
#[cfg(not(windows))]
pub fn apply(_choices: &[AssociationChoice]) -> Result<bool, String> {
    Ok(false)
}

#[cfg(windows)]
pub fn apply(choices: &[AssociationChoice]) -> Result<bool, String> {
    windows_impl::apply(choices)?;
    Ok(true)
}

#[cfg(windows)]
mod windows_impl {
    use super::{is_supported_extension, AssociationChoice};
    use winreg::enums::{HKEY_CLASSES_ROOT, HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};
    use winreg::{RegKey, RegValue};

    /// IThumbnailProvider shell-extension interface id.
    const THUMBNAIL_IID: &str = "{e357fccd-a995-4576-b01f-234630154e96}";
    /// Value on the extension key remembering the ProgID we displaced.
    const BACKUP_VALUE: &str = "MBViewerPreviousProgId";

    fn err(e: std::io::Error) -> String {
        e.to_string()
    }

    pub fn apply(choices: &[AssociationChoice]) -> Result<(), String> {
        let exe = std::env::current_exe().map_err(err)?;
        let exe = exe.to_string_lossy().into_owned();
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (classes, _) = hkcu.create_subkey("Software\\Classes").map_err(err)?;

        for choice in choices {
            let ext = choice.ext.to_ascii_lowercase();
            if !is_supported_extension(&ext) {
                return Err(format!("unsupported extension: {ext}"));
            }
            if choice.enabled {
                register(&classes, &ext, &exe)?;
            } else {
                unregister(&classes, &ext)?;
            }
        }

        refresh_shell();
        Ok(())
    }

    fn progid_for(ext: &str) -> String {
        format!("MBViewer.{}", ext)
    }

    fn register(classes: &RegKey, ext: &str, exe: &str) -> Result<(), String> {
        let progid = progid_for(ext);

        let (progid_key, _) = classes.create_subkey(&progid).map_err(err)?;
        progid_key
            .set_value("", &format!("{} — MB Viewer", ext.to_ascii_uppercase()))
            .map_err(err)?;
        let (command, _) = progid_key.create_subkey("shell\\open\\command").map_err(err)?;
        command.set_value("", &format!("\"{exe}\" \"%1\"")).map_err(err)?;

        // Keep Explorer thumbnails: inherit the thumbnail provider that served
        // this extension before us; otherwise show the MB Viewer app icon.
        if let Some(clsid) = existing_thumbnail_provider(ext, &progid) {
            let (shellex, _) = progid_key
                .create_subkey(format!("ShellEx\\{THUMBNAIL_IID}"))
                .map_err(err)?;
            shellex.set_value("", &clsid).map_err(err)?;
        } else {
            let (icon, _) = progid_key.create_subkey("DefaultIcon").map_err(err)?;
            icon.set_value("", &format!("\"{exe}\",0")).map_err(err)?;
        }

        let (ext_key, _) = classes.create_subkey(format!(".{ext}")).map_err(err)?;
        // Remember whoever was the default before, to restore on opt-out.
        let previous: Option<String> = ext_key.get_value::<String, _>("").ok();
        if let Some(previous) = previous.filter(|p| !p.is_empty() && *p != progid) {
            ext_key.set_value(BACKUP_VALUE, &previous).map_err(err)?;
        }
        ext_key.set_value("", &progid).map_err(err)?;

        // Always appear in the "Open with" list, even when the user keeps
        // another default app (Windows may protect that via UserChoice).
        let (open_with, _) = ext_key.create_subkey("OpenWithProgids").map_err(err)?;
        open_with
            .set_raw_value(
                &progid,
                &RegValue { bytes: vec![], vtype: winreg::enums::RegType::REG_NONE },
            )
            .map_err(err)?;
        Ok(())
    }

    fn unregister(classes: &RegKey, ext: &str) -> Result<(), String> {
        let progid = progid_for(ext);

        if let Ok(ext_key) =
            classes.open_subkey_with_flags(format!(".{ext}"), KEY_READ | KEY_SET_VALUE)
        {
            if ext_key.get_value::<String, _>("").ok().as_deref() == Some(progid.as_str()) {
                match ext_key.get_value::<String, _>(BACKUP_VALUE) {
                    Ok(previous) => ext_key.set_value("", &previous).map_err(err)?,
                    Err(_) => {
                        let _ = ext_key.delete_value("");
                    }
                }
            }
            let _ = ext_key.delete_value(BACKUP_VALUE);
            if let Ok(open_with) =
                ext_key.open_subkey_with_flags("OpenWithProgids", KEY_SET_VALUE)
            {
                let _ = open_with.delete_value(&progid);
            }
        }
        let _ = classes.delete_subkey_all(&progid);
        Ok(())
    }

    /// Find the thumbnail-provider CLSID that currently serves `ext`, looking
    /// through the merged HKLM/HKCU view (HKCR): the current default ProgID,
    /// the extension key itself, and SystemFileAssociations.
    fn existing_thumbnail_provider(ext: &str, our_progid: &str) -> Option<String> {
        let hkcr = RegKey::predef(HKEY_CLASSES_ROOT);

        let mut candidates: Vec<String> = Vec::new();
        if let Ok(ext_key) = hkcr.open_subkey(format!(".{ext}")) {
            if let Ok(current) = ext_key.get_value::<String, _>("") {
                if !current.is_empty() && current != our_progid {
                    candidates.push(format!("{current}\\ShellEx\\{THUMBNAIL_IID}"));
                }
            }
            // The ProgID we displaced on a previous apply still knows the provider.
            if let Ok(previous) = ext_key.get_value::<String, _>(BACKUP_VALUE) {
                if !previous.is_empty() {
                    candidates.push(format!("{previous}\\ShellEx\\{THUMBNAIL_IID}"));
                }
            }
        }
        candidates.push(format!(".{ext}\\ShellEx\\{THUMBNAIL_IID}"));
        candidates.push(format!("SystemFileAssociations\\.{ext}\\ShellEx\\{THUMBNAIL_IID}"));

        for path in candidates {
            if let Ok(key) = hkcr.open_subkey(&path) {
                if let Ok(clsid) = key.get_value::<String, _>("") {
                    if !clsid.is_empty() {
                        return Some(clsid);
                    }
                }
            }
        }
        None
    }

    /// Tell Explorer the associations changed so icons/handlers refresh
    /// without a log-off.
    fn refresh_shell() {
        use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
        unsafe {
            SHChangeNotify(
                SHCNE_ASSOCCHANGED as i32,
                SHCNF_IDLIST,
                std::ptr::null(),
                std::ptr::null(),
            );
        }
    }
}
