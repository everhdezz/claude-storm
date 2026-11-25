//! Claude Code keeps each conversation under `<config>/projects/<cwd as a folder name>/`, so a session
//! that moves into its worktree mid-conversation needs its transcript copied there to keep resuming.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Folder name Claude Code gives a working directory: every character that is not an ASCII letter or
/// digit becomes `-` (one per UTF-16 unit, as in JavaScript). Longer names get a hash suffix we cannot
/// reproduce, so they return None.
pub fn project_folder_name(cwd: &Path) -> Option<String> {
    let mut name = String::new();
    for c in cwd.to_string_lossy().chars() {
        if c.is_ascii_alphanumeric() {
            name.push(c);
        } else {
            name.extend(std::iter::repeat_n('-', c.len_utf16()));
        }
    }
    (name.len() <= 200).then_some(name)
}

/// Claude Code's config folder for an account's environment (`CLAUDE_CONFIG_DIR` or `~/.claude`).
pub fn config_dir(account_vars: &HashMap<String, String>) -> Option<PathBuf> {
    match account_vars.get("CLAUDE_CONFIG_DIR") {
        Some(dir) => Some(PathBuf::from(dir)),
        None => dirs::home_dir().map(|h| h.join(".claude")),
    }
}

/// Copies the transcript of `claude_session_id` (wherever Claude Code stored it) to the folder of
/// `new_cwd`. Returns false when there was no transcript to copy.
pub fn copy_to_cwd(config: &Path, claude_session_id: &str, new_cwd: &Path) -> std::io::Result<bool> {
    let real_cwd = std::fs::canonicalize(new_cwd)?;
    let Some(folder) = project_folder_name(&real_cwd) else { return Ok(false) };
    let projects = config.join("projects");
    let target = projects.join(&folder);
    let file = format!("{claude_session_id}.jsonl");
    if target.join(&file).exists() {
        return Ok(true);
    }
    let Some(source) = std::fs::read_dir(&projects)?.flatten().map(|e| e.path()).find(|dir| dir.join(&file).is_file()) else {
        return Ok(false);
    };
    std::fs::create_dir_all(&target)?;
    std::fs::copy(source.join(&file), target.join(&file))?;
    // Subagent transcripts and large tool results live in a folder named after the session.
    let extras = source.join(claude_session_id);
    if extras.is_dir() {
        copy_dir(&extras, &target.join(claude_session_id))?;
    }
    Ok(true)
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            copy_dir(&path, &to.join(entry.file_name()))?;
        } else {
            std::fs::copy(&path, to.join(entry.file_name()))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn folder_names_match_claude_code() {
        assert_eq!(project_folder_name(Path::new("/private/var/www/html/claudestorm")).unwrap(), "-private-var-www-html-claudestorm");
        assert_eq!(
            project_folder_name(Path::new("/Users/a/Library/Application Support/dev.claudestorm.app/x")).unwrap(),
            "-Users-a-Library-Application-Support-dev-claudestorm-app-x"
        );
        assert_eq!(project_folder_name(Path::new("/a/ñ😀")).unwrap(), "-a----");
        assert!(project_folder_name(Path::new(&"a".repeat(201))).is_none());
    }

    #[test]
    fn copies_the_transcript_next_to_the_new_cwd() {
        let root = std::env::temp_dir().join(format!("claude-storm-transcript-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let config = root.join("config");
        let old = config.join("projects/-old-repo");
        fs::create_dir_all(old.join("abc/subagents")).unwrap();
        fs::write(old.join("abc.jsonl"), "{}\n").unwrap();
        fs::write(old.join("abc/subagents/a.jsonl"), "{}\n").unwrap();
        let wt = root.join("wt");
        fs::create_dir_all(&wt).unwrap();

        assert!(copy_to_cwd(&config, "abc", &wt).unwrap());
        let target = config.join("projects").join(project_folder_name(&fs::canonicalize(&wt).unwrap()).unwrap());
        assert!(target.join("abc.jsonl").is_file());
        assert!(target.join("abc/subagents/a.jsonl").is_file());
        assert!(!copy_to_cwd(&config, "missing", &wt).unwrap());
        let _ = fs::remove_dir_all(root);
    }
}
