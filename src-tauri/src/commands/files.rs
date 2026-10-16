//! Browsing and editing the files of a project's repos (the Projects tree and the code editor).

use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::store::Store;

/// Files larger than this are not opened in the editor.
const MAX_EDIT_BYTES: u64 = 2 * 1024 * 1024;
/// Entries never listed in the tree.
const HIDDEN: &[&str] = &[".git", ".DS_Store"];

/// One entry of a repo folder; `path` is relative to the repo root, with `/`.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub dir: bool,
}

/// Root folder of a repo of the project.
fn repo_root(store: &Store, project_id: &str, repo_id: &str) -> AppResult<PathBuf> {
    let project = store.project(project_id)?;
    let repo = project.repos.iter().find(|r| r.id == repo_id).ok_or_else(|| AppError::NotFound(format!("repo {repo_id}")))?;
    Ok(PathBuf::from(&repo.path))
}

/// Resolves a path relative to the repo, refusing anything that could leave it.
fn resolve(root: &Path, rel: &str) -> AppResult<PathBuf> {
    let rel = Path::new(rel);
    if rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(AppError::msg(format!("Invalid path: {}", rel.display())));
    }
    Ok(root.join(rel))
}

/// Entries of one folder, folders first, sorted by name ignoring case.
fn list_dir(root: &Path, rel: &str) -> AppResult<Vec<FileEntry>> {
    let dir = resolve(root, rel)?;
    let mut entries: Vec<FileEntry> = fs::read_dir(&dir)?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if HIDDEN.contains(&name.as_str()) {
                return None;
            }
            // Follows symlinks so a linked folder can be expanded too.
            let is_dir = fs::metadata(entry.path()).map(|m| m.is_dir()).unwrap_or(false);
            let path = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            Some(FileEntry { name, path, dir: is_dir })
        })
        .collect();
    entries.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(entries)
}

/// Text of a file, refusing binaries and very large files.
fn read_text(path: &Path) -> AppResult<String> {
    let size = fs::metadata(path)?.len();
    if size > MAX_EDIT_BYTES {
        return Err(AppError::msg(format!("File too large to edit ({} KB)", size / 1024)));
    }
    let bytes = fs::read(path)?;
    if bytes.iter().take(8192).any(|b| *b == 0) {
        return Err(AppError::msg("Binary file"));
    }
    String::from_utf8(bytes).map_err(|_| AppError::msg("The file is not UTF-8 text"))
}

/// Entries of a folder of a repo (`path` "" for the repo root).
#[tauri::command]
pub fn repo_list_dir(store: State<Store>, project_id: String, repo_id: String, path: String) -> AppResult<Vec<FileEntry>> {
    list_dir(&repo_root(&store, &project_id, &repo_id)?, &path)
}

/// Text of a file of a repo.
#[tauri::command]
pub fn repo_read_file(store: State<Store>, project_id: String, repo_id: String, path: String) -> AppResult<String> {
    read_text(&resolve(&repo_root(&store, &project_id, &repo_id)?, &path)?)
}

/// Saves the text of an existing file of a repo.
#[tauri::command]
pub fn repo_write_file(store: State<Store>, project_id: String, repo_id: String, path: String, content: String) -> AppResult<()> {
    let full = resolve(&repo_root(&store, &project_id, &repo_id)?, &path)?;
    if !full.is_file() {
        return Err(AppError::NotFound(path));
    }
    fs::write(full, content)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_folders_first_and_hides_git() {
        let dir = std::env::temp_dir().join(format!("cs-files-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(dir.join("b.txt"), "b").unwrap();
        fs::write(dir.join("A.md"), "a").unwrap();
        fs::write(dir.join("src/main.rs"), "fn main() {}").unwrap();
        let names: Vec<_> = list_dir(&dir, "").unwrap().into_iter().map(|e| e.path).collect();
        assert_eq!(names, ["src", "A.md", "b.txt"]);
        assert_eq!(list_dir(&dir, "src").unwrap()[0].path, "src/main.rs");
        assert!(list_dir(&dir, "../").is_err());
        fs::write(dir.join("bin"), [0u8, 1, 2]).unwrap();
        assert!(read_text(&dir.join("bin")).is_err());
        assert_eq!(read_text(&dir.join("A.md")).unwrap(), "a");
        fs::remove_dir_all(dir).unwrap();
    }
}
