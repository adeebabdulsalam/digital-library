use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntry {
    pub name: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub is_dir: bool,
}

fn is_hidden(entry: &walkdir::DirEntry) -> bool {
    entry
        .file_name()
        .to_string_lossy()
        .starts_with('.')
}

fn normalize_relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(|p| {
            let s = p.to_string_lossy();
            s.replace('\\', "/")
        })
        .unwrap_or_default()
}

/// Recursively list files and folders under `root` (excluding hidden segments).
#[tauri::command]
fn walk_library(root: String) -> Result<Vec<LibraryEntry>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err("Library path is not a directory".into());
    }
    let root_canon = fs::canonicalize(&root_path).map_err(|e| e.to_string())?;

    let mut out = Vec::new();

    for entry in WalkDir::new(&root_canon)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| !is_hidden(e))
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path == root_canon.as_path() {
            continue;
        }

        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let is_dir = meta.is_dir();
        let name = entry
            .file_name()
            .to_string_lossy()
            .into_owned();
        let relative_path = normalize_relative(&root_canon, path);
        let absolute_path = path.to_string_lossy().into_owned();

        out.push(LibraryEntry {
            name,
            relative_path,
            absolute_path,
            is_dir,
        });
    }

    out.sort_by(|a, b| a.relative_path.to_lowercase().cmp(&b.relative_path.to_lowercase()));
    Ok(out)
}

/// First-level subfolder names under `root` (categories).
#[tauri::command]
fn list_categories(root: String) -> Result<Vec<String>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err("Library path is not a directory".into());
    }

    let mut cats = Vec::new();
    for entry in fs::read_dir(&root_path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with('.')
        {
            continue;
        }
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_dir() {
            cats.push(entry.file_name().to_string_lossy().into_owned());
        }
    }
    cats.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(cats)
}

/// Open a file or folder under `library_root` in the system default app / explorer.
/// Uses the opener crate directly so we are not blocked by empty `opener` IPC scopes (see Tauri plugin-opener ACL).
#[tauri::command]
fn open_library_path(library_root: String, path: String) -> Result<(), String> {
    let root = PathBuf::from(&library_root);
    let target = PathBuf::from(&path);
    let root_canon = fs::canonicalize(&root).map_err(|e| e.to_string())?;
    let target_canon = fs::canonicalize(&target).map_err(|e| e.to_string())?;
    if !target_canon.starts_with(&root_canon) {
        return Err("Path is outside the selected library folder".into());
    }
    tauri_plugin_opener::open_path(&target_canon, None::<&str>).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![walk_library, list_categories, open_library_path])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
