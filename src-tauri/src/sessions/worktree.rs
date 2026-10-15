//! Git worktree helpers for isolated sessions.

use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::git::run_git;

/// Converts a title into a branch-safe slug.
pub fn slugify(title: &str) -> String {
    let mut slug = String::new();
    for ch in title.to_lowercase().chars() {
        let mapped = match ch {
            'á' | 'à' | 'ä' => 'a',
            'é' | 'è' | 'ë' => 'e',
            'í' | 'ì' | 'ï' => 'i',
            'ó' | 'ò' | 'ö' => 'o',
            'ú' | 'ù' | 'ü' => 'u',
            'ñ' => 'n',
            c if c.is_ascii_alphanumeric() => c,
            _ => '-',
        };
        if mapped != '-' || !slug.ends_with('-') {
            slug.push(mapped);
        }
    }
    let slug: String = slug.trim_matches('-').chars().take(40).collect();
    if slug.is_empty() { "session".into() } else { slug.trim_end_matches('-').to_string() }
}

/// Current branch of a repo.
pub fn current_branch(repo: &Path) -> AppResult<String> {
    Ok(run_git(repo, &["rev-parse", "--abbrev-ref", "HEAD"])?.trim().to_string())
}

/// Creates `worktree` on a new `branch` starting at the repo's current HEAD.
pub fn add(repo: &Path, worktree: &Path, branch: &str) -> AppResult<()> {
    if let Some(parent) = worktree.parent() {
        std::fs::create_dir_all(parent)?;
    }
    run_git(repo, &["worktree", "add", "-b", branch, &worktree.to_string_lossy(), "HEAD"])?;
    Ok(())
}

/// Diff of the worktree (committed and uncommitted) against the base branch.
pub fn diff(worktree: &Path, base: &str) -> AppResult<String> {
    run_git(worktree, &["add", "-A", "--intent-to-add"])?;
    run_git(worktree, &["diff", "--no-color", base])
}

/// Commits every change in the worktree; returns false when there was nothing to commit.
pub fn commit(worktree: &Path, message: &str) -> AppResult<bool> {
    run_git(worktree, &["add", "-A"])?;
    if run_git(worktree, &["status", "--porcelain"])?.trim().is_empty() {
        return Ok(false);
    }
    run_git(worktree, &["commit", "-m", message])?;
    Ok(true)
}

/// Merges the session branch into the base branch of the main checkout.
pub fn merge(repo: &Path, base: &str, branch: &str) -> AppResult<String> {
    let current = current_branch(repo)?;
    if current != base {
        return Err(AppError::msg(format!(
            "{} is on '{current}', not on the base branch '{base}'. Check out '{base}' first.",
            repo.display()
        )));
    }
    run_git(repo, &["merge", "--no-ff", "--no-edit", branch])
}

/// Removes the worktree and optionally deletes its branch.
pub fn remove(repo: &Path, worktree: &Path, branch: &str, delete_branch: bool) -> AppResult<()> {
    if worktree.exists() {
        run_git(repo, &["worktree", "remove", "--force", &worktree.to_string_lossy()])?;
    }
    let _ = run_git(repo, &["worktree", "prune"]);
    if delete_branch {
        run_git(repo, &["branch", "-D", branch])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn slugifies_spanish_titles() {
        assert_eq!(slugify("Arreglar el login de México!"), "arreglar-el-login-de-mexico");
        assert_eq!(slugify("   "), "session");
    }

    #[test]
    fn full_worktree_cycle() {
        let root = std::env::temp_dir().join(format!("claude-storm-wt-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let repo = root.join("repo");
        fs::create_dir_all(&repo).unwrap();
        run_git(&repo, &["init", "-q", "-b", "main"]).unwrap();
        run_git(&repo, &["config", "user.email", "t@t"]).unwrap();
        run_git(&repo, &["config", "user.name", "t"]).unwrap();
        fs::write(repo.join("a.txt"), "one\n").unwrap();
        run_git(&repo, &["add", "."]).unwrap();
        run_git(&repo, &["commit", "-qm", "init"]).unwrap();

        let wt = root.join("wt/repo");
        add(&repo, &wt, "claude-storm/test").unwrap();
        fs::write(wt.join("a.txt"), "two\n").unwrap();
        fs::write(wt.join("b.txt"), "new\n").unwrap();
        let d = diff(&wt, "main").unwrap();
        assert!(d.contains("+two") && d.contains("b.txt"), "{d}");
        assert!(commit(&wt, "change").unwrap());
        assert!(!commit(&wt, "noop").unwrap());
        merge(&repo, "main", "claude-storm/test").unwrap();
        assert_eq!(fs::read_to_string(repo.join("a.txt")).unwrap(), "two\n");
        remove(&repo, &wt, "claude-storm/test", true).unwrap();
        assert!(!wt.exists());
        let _ = fs::remove_dir_all(root);
    }
}
