//! Per-project wiki: a folder tree of Markdown documents under `<app data>/wiki/<project id>`.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::commands::windows::project_window_label;

use crate::error::{AppError, AppResult};

/// One folder or document of the wiki tree; `path` is relative to the wiki root, with `/`.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WikiNode {
    pub name: String,
    pub path: String,
    pub kind: WikiKind,
    /// Stable id of a document (survives renames and moves); `wiki://<id>` references it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<WikiNode>,
}

#[derive(Debug, Serialize, PartialEq, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WikiKind {
    Folder,
    Doc,
}

/// Wiki root of a project; created on first use.
pub fn root<R: Runtime>(app: &AppHandle<R>, project_id: &str) -> AppResult<PathBuf> {
    if project_id.is_empty() || project_id.contains(['/', '\\', '.']) {
        return Err(AppError::msg("Invalid project id"));
    }
    let dir = app.path().app_data_dir()?.join("wiki").join(project_id);
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Tells the project window that its wiki changed outside the UI (e.g. Claude edited it).
pub fn emit_changed<R: Runtime>(app: &AppHandle<R>, project_id: &str, paths: &[&str]) {
    let _ = app.emit_to(project_window_label(project_id).as_str(), WIKI_CHANGED, WikiChanged { project_id, paths });
}

pub const WIKI_CHANGED: &str = "wiki-changed";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WikiChanged<'a> {
    project_id: &'a str,
    paths: &'a [&'a str],
}

/// Resolves a relative wiki path, refusing anything that could leave the root.
fn resolve(root: &Path, rel: &str) -> AppResult<PathBuf> {
    let rel = Path::new(rel);
    if rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(AppError::msg(format!("Invalid wiki path: {}", rel.display())));
    }
    Ok(root.join(rel))
}

/// Relative path with `/` separators, as the UI sees it.
fn relative(root: &Path, full: &Path) -> String {
    full.strip_prefix(root).unwrap_or(full).components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/")
}

/// A file or folder name the user typed: trimmed, without separators, not hidden.
fn clean_name(name: &str) -> AppResult<String> {
    let name = name.trim().replace(['/', '\\'], "-");
    if name.is_empty() || name.starts_with('.') {
        return Err(AppError::msg("Invalid name"));
    }
    Ok(name)
}

/// `dir/name` (plus `.md` for documents), adding " 2", " 3"… until nothing exists there.
fn unique(dir: &Path, name: &str, kind: WikiKind) -> PathBuf {
    let ext = if kind == WikiKind::Doc { ".md" } else { "" };
    let mut candidate = dir.join(format!("{name}{ext}"));
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{name} {n}{ext}"));
        n += 1;
    }
    candidate
}

pub fn read_tree(root: &Path, dir: &Path) -> AppResult<Vec<WikiNode>> {
    let mut nodes = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            nodes.push(WikiNode { name: file_name, path: relative(root, &path), kind: WikiKind::Folder, id: None, children: read_tree(root, &path)? });
        } else if let Some(stem) = file_name.strip_suffix(".md") {
            nodes.push(WikiNode { name: stem.to_string(), path: relative(root, &path), kind: WikiKind::Doc, id: None, children: Vec::new() });
        }
    }
    nodes.sort_by(|a, b| (a.kind != WikiKind::Folder, a.name.to_lowercase()).cmp(&(b.kind != WikiKind::Folder, b.name.to_lowercase())));
    Ok(nodes)
}

/// Hidden file in the wiki root mapping each document's path to its id.
const IDS_FILE: &str = ".ids.json";
/// Scheme of the references copied for chats: `wiki://<id>`.
pub const REF_SCHEME: &str = "wiki://";

/// Serializes changes to the id index (the UI and Claude's tools may edit at once).
static IDS_LOCK: Mutex<()> = Mutex::new(());

fn load_ids(root: &Path) -> BTreeMap<String, String> {
    fs::read_to_string(root.join(IDS_FILE)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save_ids(root: &Path, ids: &BTreeMap<String, String>) -> AppResult<()> {
    fs::write(root.join(IDS_FILE), serde_json::to_string_pretty(ids).unwrap_or_default())?;
    Ok(())
}

/// Runs `f` on the id index and saves it if it changed.
fn edit_ids<T>(root: &Path, f: impl FnOnce(&mut BTreeMap<String, String>) -> T) -> AppResult<T> {
    let _guard = IDS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut ids = load_ids(root);
    let before = ids.clone();
    let out = f(&mut ids);
    if ids != before {
        save_ids(root, &ids)?;
    }
    Ok(out)
}

/// Whether `path` is `prefix` itself or inside it.
fn within(path: &str, prefix: &str) -> bool {
    path == prefix || path.strip_prefix(prefix).is_some_and(|rest| rest.starts_with('/'))
}

fn doc_paths<'a>(nodes: &'a mut [WikiNode], out: &mut Vec<&'a mut WikiNode>) {
    for node in nodes {
        match node.kind {
            WikiKind::Folder => doc_paths(&mut node.children, out),
            WikiKind::Doc => out.push(node),
        }
    }
}

/// The tree with every document's id, giving new ids to documents that have none (e.g. added in
/// Finder) and forgetting the ids of documents that are gone.
pub fn tree(root: &Path) -> AppResult<Vec<WikiNode>> {
    let mut nodes = read_tree(root, root)?;
    let mut docs = Vec::new();
    doc_paths(&mut nodes, &mut docs);
    edit_ids(root, |ids| {
        let mut kept = BTreeMap::new();
        for doc in docs {
            let id = ids.get(&doc.path).cloned().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            kept.insert(doc.path.clone(), id.clone());
            doc.id = Some(id);
        }
        *ids = kept;
    })?;
    Ok(nodes)
}

/// Path of the document a reference points to: `wiki://<id>`, a bare id, or `[Title](wiki://<id>)`.
pub fn path_of_ref(root: &Path, reference: &str) -> Option<String> {
    let reference = reference.trim();
    let id = match reference.find(REF_SCHEME) {
        Some(i) => reference[i + REF_SCHEME.len()..].trim_end_matches([')', '>', ' ']),
        None => reference,
    };
    if uuid::Uuid::parse_str(id).is_err() {
        return None;
    }
    tree(root).ok()?;
    load_ids(root).into_iter().find(|(_, v)| v == id).map(|(path, _)| path)
}

/// Folders and Markdown documents of the project's wiki, folders first.
#[tauri::command]
pub fn wiki_tree(app: AppHandle, project_id: String) -> AppResult<Vec<WikiNode>> {
    tree(&root(&app, &project_id)?)
}

/// Absolute path of the project's wiki folder (to reveal it in Finder).
#[tauri::command]
pub fn wiki_root(app: AppHandle, project_id: String) -> AppResult<String> {
    Ok(root(&app, &project_id)?.to_string_lossy().to_string())
}

/// Markdown of a document.
#[tauri::command]
pub fn wiki_read(app: AppHandle, project_id: String, path: String) -> AppResult<String> {
    read(&root(&app, &project_id)?, &path)
}

/// Saves a document's Markdown.
#[tauri::command]
pub fn wiki_write(app: AppHandle, project_id: String, path: String, content: String) -> AppResult<()> {
    write(&root(&app, &project_id)?, &path, &content)
}

/// Creates a document or folder inside `parent` ("" for the root); returns its path.
#[tauri::command]
pub fn wiki_create(app: AppHandle, project_id: String, parent: String, name: String, kind: WikiKind) -> AppResult<String> {
    create(&root(&app, &project_id)?, &parent, &name, kind, "")
}

/// Renames a document or folder in place; returns its new path.
#[tauri::command]
pub fn wiki_rename(app: AppHandle, project_id: String, path: String, name: String) -> AppResult<String> {
    rename(&root(&app, &project_id)?, &path, &name)
}

/// Moves a document or folder into another folder ("" for the root); returns its new path.
#[tauri::command]
pub fn wiki_move(app: AppHandle, project_id: String, path: String, parent: String) -> AppResult<String> {
    move_to(&root(&app, &project_id)?, &path, &parent)
}

/// Deletes a document, or a folder with everything inside.
#[tauri::command]
pub fn wiki_delete(app: AppHandle, project_id: String, path: String) -> AppResult<()> {
    delete(&root(&app, &project_id)?, &path)
}

pub fn read(root: &Path, path: &str) -> AppResult<String> {
    let file = resolve(root, path)?;
    if !file.is_file() {
        return Err(AppError::NotFound(path.to_string()));
    }
    Ok(fs::read_to_string(file)?)
}

pub fn write(root: &Path, path: &str, content: &str) -> AppResult<()> {
    let file = resolve(root, path)?;
    if !file.is_file() {
        return Err(AppError::NotFound(path.to_string()));
    }
    fs::write(file, content)?;
    Ok(())
}

/// Creates a document (with `content`) or folder inside `parent`; returns its path.
pub fn create(root: &Path, parent: &str, name: &str, kind: WikiKind, content: &str) -> AppResult<String> {
    let dir = if parent.is_empty() { root.to_path_buf() } else { resolve(root, parent)? };
    if !dir.is_dir() {
        return Err(AppError::NotFound(parent.to_string()));
    }
    let target = unique(&dir, &clean_name(name)?, kind);
    match kind {
        WikiKind::Folder => fs::create_dir(&target)?,
        WikiKind::Doc => fs::write(&target, content)?,
    }
    let path = relative(root, &target);
    if kind == WikiKind::Doc {
        edit_ids(root, |ids| ids.insert(path.clone(), uuid::Uuid::new_v4().to_string()))?;
    }
    Ok(path)
}

pub fn rename(root: &Path, path: &str, name: &str) -> AppResult<String> {
    let from = resolve(root, path)?;
    if !from.exists() {
        return Err(AppError::NotFound(path.to_string()));
    }
    let kind = if from.is_dir() { WikiKind::Folder } else { WikiKind::Doc };
    let ext = if kind == WikiKind::Doc { ".md" } else { "" };
    let to = from.with_file_name(format!("{}{ext}", clean_name(name)?));
    if to == from {
        return Ok(path.to_string());
    }
    let to = if to.exists() { unique(from.parent().unwrap_or(root), &clean_name(name)?, kind) } else { to };
    fs::rename(&from, &to)?;
    let to = relative(root, &to);
    remap_ids(root, path, &to)?;
    Ok(to)
}

pub fn move_to(root: &Path, path: &str, parent: &str) -> AppResult<String> {
    let from = resolve(root, path)?;
    if !from.exists() {
        return Err(AppError::NotFound(path.to_string()));
    }
    let dir = if parent.is_empty() { root.to_path_buf() } else { resolve(root, parent)? };
    if !dir.is_dir() {
        return Err(AppError::NotFound(parent.to_string()));
    }
    if dir.starts_with(&from) {
        return Err(AppError::msg("A folder cannot be moved inside itself"));
    }
    if from.parent() == Some(dir.as_path()) {
        return Ok(path.to_string());
    }
    let kind = if from.is_dir() { WikiKind::Folder } else { WikiKind::Doc };
    let stem = from.file_stem().unwrap_or_default().to_string_lossy().to_string();
    let name = if kind == WikiKind::Folder { from.file_name().unwrap_or_default().to_string_lossy().to_string() } else { stem };
    let to = unique(&dir, &name, kind);
    fs::rename(&from, &to)?;
    let to = relative(root, &to);
    remap_ids(root, path, &to)?;
    Ok(to)
}

/// Keeps the ids of a renamed or moved document, or of every document in a moved folder.
fn remap_ids(root: &Path, from: &str, to: &str) -> AppResult<()> {
    edit_ids(root, |ids| {
        let moved: Vec<String> = ids.keys().filter(|p| within(p, from)).cloned().collect();
        for old in moved {
            if let Some(id) = ids.remove(&old) {
                ids.insert(format!("{to}{}", &old[from.len()..]), id);
            }
        }
    })
}

pub fn delete(root: &Path, path: &str) -> AppResult<()> {
    let target = resolve(root, path)?;
    if target == root {
        return Err(AppError::msg("The wiki root cannot be deleted"));
    }
    if target.is_dir() {
        fs::remove_dir_all(target)?;
    } else if target.is_file() {
        fs::remove_file(target)?;
    } else {
        return Err(AppError::NotFound(path.to_string()));
    }
    edit_ids(root, |ids| ids.retain(|p, _| !within(p, path)))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_rejects_escapes() {
        let root = Path::new("/w");
        assert!(resolve(root, "../x.md").is_err());
        assert!(resolve(root, "/etc/passwd").is_err());
        assert!(resolve(root, "a/../../x").is_err());
        assert_eq!(resolve(root, "a/b.md").unwrap(), PathBuf::from("/w/a/b.md"));
    }

    #[test]
    fn tree_lists_folders_first_and_only_markdown() {
        let root = std::env::temp_dir().join(format!("claude-storm-wiki-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("Guías")).unwrap();
        fs::write(root.join("Guías/Setup.md"), "# Setup").unwrap();
        fs::write(root.join("Inicio.md"), "").unwrap();
        fs::write(root.join("notas.txt"), "").unwrap();
        fs::write(root.join(".DS_Store"), "").unwrap();
        let tree = read_tree(&root, &root).unwrap();
        assert_eq!(tree.iter().map(|n| n.path.as_str()).collect::<Vec<_>>(), ["Guías", "Inicio.md"]);
        assert_eq!(tree[0].children[0].name, "Setup");
        assert_eq!(unique(&root, "Inicio", WikiKind::Doc), root.join("Inicio 2.md"));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn ids_follow_renames_and_moves() {
        let root = std::env::temp_dir().join(format!("claude-storm-wiki-ids-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        create(&root, "", "Guías", WikiKind::Folder, "").unwrap();
        let doc = create(&root, "Guías", "Setup", WikiKind::Doc, "# Setup").unwrap();
        let id = tree(&root).unwrap()[0].children[0].id.clone().unwrap();
        let renamed = rename(&root, "Guías", "Docs").unwrap();
        assert_eq!(renamed, "Docs");
        assert_eq!(path_of_ref(&root, &format!("[Setup](wiki://{id})")).as_deref(), Some("Docs/Setup.md"));
        let moved = move_to(&root, "Docs/Setup.md", "").unwrap();
        assert_eq!(path_of_ref(&root, &id).as_deref(), Some(moved.as_str()));
        assert_ne!(doc, moved);
        // A page added from Finder gets an id; a deleted one loses it.
        fs::write(root.join("Externa.md"), "").unwrap();
        assert!(tree(&root).unwrap().iter().all(|n| n.kind == WikiKind::Folder || n.id.is_some()));
        delete(&root, &moved).unwrap();
        assert_eq!(path_of_ref(&root, &id), None);
        fs::remove_dir_all(&root).unwrap();
    }
}
