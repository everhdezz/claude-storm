//! Search Everywhere for the repos of a project: file names (fuzzy, like WebStorm's "Go to File")
//! and text inside files ("Find in Files"). Git repos use git, so `.gitignore` is respected; plain
//! folders are walked, skipping dependency and build folders.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

/// Folders never walked in repos without git.
const SKIP_DIRS: &[&str] = &[".git", "node_modules", "vendor", "target", "dist", "build", ".next", ".nuxt", ".venv", "__pycache__", ".idea"];
/// Most files listed per repo (huge monorepos stay responsive).
const MAX_FILES: usize = 200_000;
/// Files read per repo by the text search in folders without git.
const MAX_TEXT_FILE_BYTES: u64 = 1024 * 1024;
/// File lists are reused while the user types.
const LIST_TTL: Duration = Duration::from_secs(15);
/// Longest line text sent back.
const MAX_LINE_CHARS: usize = 240;

/// A file whose name matches; `positions` are the matched char indices in `path`, for highlighting.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NameHit {
    pub repo_id: String,
    pub path: String,
    pub positions: Vec<usize>,
    #[serde(skip)]
    pub score: i64,
}

/// A line containing the text.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextHit {
    pub repo_id: String,
    pub path: String,
    pub line: u32,
    pub text: String,
}

type FileList = std::sync::Arc<Vec<String>>;

/// Recent file lists per repo folder.
#[derive(Default)]
pub struct FileLists {
    cache: Mutex<HashMap<PathBuf, (Instant, FileList)>>,
}

impl FileLists {
    /// Files of a repo relative to its root, with `/`.
    pub fn get(&self, root: &Path) -> FileList {
        if let Some((at, list)) = self.cache.lock().unwrap().get(root) {
            if at.elapsed() < LIST_TTL {
                return list.clone();
            }
        }
        let list = std::sync::Arc::new(list_files(root));
        self.cache.lock().unwrap().insert(root.to_path_buf(), (Instant::now(), list.clone()));
        list
    }
}

fn list_files(root: &Path) -> Vec<String> {
    if crate::git::is_repo(root) {
        let out = crate::shell_env::command("git")
            .current_dir(root)
            .args(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
            .output();
        if let Some(out) = out.ok().filter(|o| o.status.success()) {
            let mut files: Vec<String> = out.stdout.split(|b| *b == 0).filter(|p| !p.is_empty()).map(|p| String::from_utf8_lossy(p).into_owned()).collect();
            // Deleted but still tracked files would open as errors.
            files.retain(|f| root.join(f).is_file());
            files.dedup();
            files.truncate(MAX_FILES);
            return files;
        }
    }
    let mut files = Vec::new();
    walk(root, "", &mut files);
    files
}

fn walk(root: &Path, rel: &str, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(root.join(rel)) else { return };
    for entry in entries.flatten() {
        if out.len() >= MAX_FILES {
            return;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
        match entry.file_type() {
            Ok(t) if t.is_dir() => {
                if !SKIP_DIRS.contains(&name.as_str()) {
                    walk(root, &path, out);
                }
            }
            Ok(t) if t.is_file() => out.push(path),
            _ => {}
        }
    }
}

/// Fuzzy match of `query` in `path` (WebStorm style): the letters must appear in order. Matching the
/// file name beats matching folders; consecutive letters, word starts and short paths score higher.
/// A query with `/` is matched against the whole path.
pub fn fuzzy(query: &str, path: &str) -> Option<(i64, Vec<usize>)> {
    let query: Vec<char> = query.chars().filter(|c| !c.is_whitespace()).flat_map(char::to_lowercase).collect();
    if query.is_empty() {
        return None;
    }
    let chars: Vec<char> = path.chars().collect();
    let lower: Vec<char> = chars.iter().map(|c| c.to_lowercase().next().unwrap_or(*c)).collect();
    let name_start = chars.iter().rposition(|c| *c == '/').map_or(0, |i| i + 1);
    let in_name = !query.contains(&'/');
    let start = if in_name { name_start } else { 0 };

    let attempt = |from: usize| -> Option<(i64, Vec<usize>)> {
        let mut positions = Vec::with_capacity(query.len());
        let mut score = 0i64;
        let mut at = from;
        for q in &query {
            let i = (at..lower.len()).find(|&i| lower[i] == *q)?;
            let word_start = i == 0 || matches!(chars[i - 1], '/' | '_' | '-' | '.' | ' ') || (chars[i].is_uppercase() && chars[i - 1].is_lowercase());
            score += if positions.last().is_some_and(|&p| p + 1 == i) { 8 } else { 1 };
            if word_start {
                score += 6;
            }
            if i >= name_start {
                score += 4;
            }
            positions.push(i);
            at = i + 1;
        }
        Some((score, positions))
    };
    let (mut score, positions) = attempt(start).or_else(|| if in_name { attempt(0) } else { None })?;
    let name: String = lower[name_start..].iter().collect();
    let q: String = query.iter().collect();
    if name == q || name.split('.').next() == Some(q.as_str()) {
        score += 40;
    } else if name.starts_with(&q) {
        score += 20;
    }
    score -= (chars.len() as i64) / 8;
    Some((score, positions))
}

/// Best file name matches across repos (`repos`: id and root).
pub fn find_names(lists: &FileLists, repos: &[(String, PathBuf)], query: &str, limit: usize) -> Vec<NameHit> {
    let mut hits: Vec<NameHit> = repos
        .iter()
        .flat_map(|(id, root)| {
            let files = lists.get(root);
            files
                .iter()
                .filter_map(|path| fuzzy(query, path).map(|(score, positions)| NameHit { repo_id: id.clone(), path: path.clone(), positions, score }))
                .collect::<Vec<_>>()
        })
        .collect();
    hits.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.path.len().cmp(&b.path.len())));
    hits.truncate(limit);
    hits
}

/// Lines containing `query` (plain text) across repos, at most `limit`.
pub fn find_text(lists: &FileLists, repos: &[(String, PathBuf)], query: &str, case_sensitive: bool, limit: usize) -> Vec<TextHit> {
    let mut hits = Vec::new();
    for (id, root) in repos {
        if hits.len() >= limit {
            break;
        }
        let left = limit - hits.len();
        let found = if crate::git::is_repo(root) { git_grep(root, query, case_sensitive, left) } else { None };
        let found = found.unwrap_or_else(|| scan(&lists.get(root), root, query, case_sensitive, left));
        hits.extend(found.into_iter().map(|(path, line, text)| TextHit { repo_id: id.clone(), path, line, text }));
    }
    hits
}

/// `git grep` over tracked and untracked (not ignored) files; None if git failed.
fn git_grep(root: &Path, query: &str, case_sensitive: bool, limit: usize) -> Option<Vec<(String, u32, String)>> {
    let mut cmd = crate::shell_env::command("git");
    cmd.current_dir(root).args(["grep", "-z", "-n", "-I", "--untracked", "--no-color", "-F"]);
    if !case_sensitive {
        cmd.arg("-i");
    }
    cmd.args(["-e", query, "--"]).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = cmd.spawn().ok()?;
    let mut hits = Vec::new();
    let reader = BufReader::new(child.stdout.take()?);
    for line in reader.split(b'\n').map_while(Result::ok) {
        let mut parts = line.splitn(3, |b| *b == 0);
        let (Some(path), Some(number), Some(text)) = (parts.next(), parts.next(), parts.next()) else { continue };
        let Some(number) = std::str::from_utf8(number).ok().and_then(|n| n.parse().ok()) else { continue };
        hits.push((String::from_utf8_lossy(path).into_owned(), number, clip(&String::from_utf8_lossy(text))));
        if hits.len() >= limit {
            break;
        }
    }
    // Stops git early once there are enough hits.
    let _ = child.kill();
    let status = child.wait().ok()?;
    // Exit code 1 is "no matches"; anything else (not a repo, old git…) falls back to scanning.
    (status.success() || status.code() == Some(1) || hits.len() >= limit).then_some(hits)
}

/// Line-by-line scan of text files, for folders without git.
fn scan(files: &[String], root: &Path, query: &str, case_sensitive: bool, limit: usize) -> Vec<(String, u32, String)> {
    let needle = if case_sensitive { query.to_string() } else { query.to_lowercase() };
    let mut hits = Vec::new();
    for rel in files {
        let path = root.join(rel);
        if std::fs::metadata(&path).map_or(true, |m| m.len() > MAX_TEXT_FILE_BYTES) {
            continue;
        }
        let mut bytes = Vec::new();
        if std::fs::File::open(&path).and_then(|mut f| f.read_to_end(&mut bytes)).is_err() || bytes.iter().take(8192).any(|b| *b == 0) {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
        for (i, line) in text.lines().enumerate() {
            let found = if case_sensitive { line.contains(&needle) } else { line.to_lowercase().contains(&needle) };
            if found {
                hits.push((rel.clone(), i as u32 + 1, clip(line)));
                if hits.len() >= limit {
                    return hits;
                }
            }
        }
    }
    hits
}

fn clip(line: &str) -> String {
    let trimmed = line.trim_end();
    if trimmed.chars().count() <= MAX_LINE_CHARS {
        return trimmed.to_string();
    }
    trimmed.chars().take(MAX_LINE_CHARS).collect::<String>() + "…"
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn fuzzy_prefers_file_names_and_word_starts() {
        let (name_score, positions) = fuzzy("sesview", "src/features/sessions/SessionView.tsx").unwrap();
        assert_eq!(positions.len(), 7);
        assert!(positions[0] >= "src/features/sessions/".len(), "matched in the file name");
        let (folder_score, _) = fuzzy("sesview", "src/sessions/review/x.ts").unwrap();
        assert!(name_score > folder_score);
        assert!(fuzzy("zzz", "src/main.rs").is_none());
        let (exact, _) = fuzzy("main", "src/main.rs").unwrap();
        let (partial, _) = fuzzy("main", "src/domain_item.rs").unwrap();
        assert!(exact > partial);
        assert!(fuzzy("api/user", "app/Api/UserController.php").is_some());
    }

    #[test]
    fn finds_names_and_text_in_git_and_plain_folders() {
        let root = std::env::temp_dir().join(format!("claude-storm-search-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let git = root.join("git");
        fs::create_dir_all(git.join("src")).unwrap();
        fs::create_dir_all(git.join("node_modules/pkg")).unwrap();
        crate::git::run_git(&git, &["init", "-q"]).unwrap();
        fs::write(git.join(".gitignore"), "node_modules/\n").unwrap();
        fs::write(git.join("src/UserController.php"), "<?php\n// Find Me here\n").unwrap();
        fs::write(git.join("node_modules/pkg/user.js"), "find me\n").unwrap();
        let plain = root.join("plain");
        fs::create_dir_all(plain.join("vendor")).unwrap();
        fs::write(plain.join("notes.md"), "nothing\nfind me too\n").unwrap();
        fs::write(plain.join("vendor/user.txt"), "find me\n").unwrap();

        let lists = FileLists::default();
        let repos = vec![("g".to_string(), git.clone()), ("p".to_string(), plain.clone())];
        let names = find_names(&lists, &repos, "usercont", 10);
        assert_eq!(names.iter().map(|h| h.path.as_str()).collect::<Vec<_>>(), ["src/UserController.php"]);

        let text = find_text(&lists, &repos, "find me", false, 10);
        let found: Vec<(&str, &str, u32)> = text.iter().map(|h| (h.repo_id.as_str(), h.path.as_str(), h.line)).collect();
        assert_eq!(found, [("g", "src/UserController.php", 2), ("p", "notes.md", 2)]);
        assert!(find_text(&lists, &repos, "find me", true, 10).iter().all(|h| h.repo_id == "p"));
        assert_eq!(find_text(&lists, &repos, "find me", false, 1).len(), 1);
        let _ = fs::remove_dir_all(root);
    }
}
