//! Git worktree helpers for isolated sessions.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::git::run_git;
use crate::models::{Project, Session};
use crate::sessions::prepare;

/// Worktrees made for an isolated session: its branch, the base branch per repo and prepare notes.
pub struct SessionWorktrees {
    pub branch: String,
    pub base_branches: HashMap<String, String>,
    pub notes: Vec<String>,
}

/// Creates one worktree + branch per git repo of the session and makes each runnable.
/// Blocking; all or nothing: a failure removes the worktrees created so far.
pub fn create_for_session(app_data: &Path, project: &Project, session: &Session) -> AppResult<SessionWorktrees> {
    let branch = format!("{}-{}", slugify(&session.title), &session.id[..6]);
    // Folders without git are used as they are; only repositories get a worktree.
    let repos: Vec<(String, String, PathBuf, PathBuf)> = project
        .repos
        .iter()
        .filter(|r| session.repo_ids.contains(&r.id) && crate::git::is_repo(Path::new(&r.path)))
        .map(|r| (r.id.clone(), r.name.clone(), PathBuf::from(&r.path), crate::sessions::manager::worktree_dir(app_data, session, &r.name)))
        .collect();
    let mut created: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut base_branches = HashMap::new();
    for (repo_id, _, repo_path, wt) in &repos {
        let result = current_branch(repo_path).and_then(|base| {
            add(repo_path, wt, &branch)?;
            Ok(base)
        });
        match result {
            Ok(base) => {
                created.push((repo_path.clone(), wt.clone()));
                base_branches.insert(repo_id.clone(), base);
            }
            Err(err) => {
                for (repo, wt) in &created {
                    let _ = remove(repo, wt, &branch, true);
                }
                return Err(err);
            }
        }
    }
    // Every worktree exists now; make each one runnable (env files, cloned dependencies).
    let notes = created.iter().zip(&repos).filter_map(|((repo, wt), (_, name, _, _))| prepare::prepare(repo, wt).summary(name)).collect();
    Ok(SessionWorktrees { branch, base_branches, notes })
}

/// True when the worktree has no uncommitted changes and no commits beyond `base`.
pub fn is_pristine(worktree: &Path, base: &str) -> bool {
    let clean = run_git(worktree, &["status", "--porcelain"]).is_ok_and(|s| s.trim().is_empty());
    let ahead = run_git(worktree, &["rev-list", "--count", &format!("{base}..HEAD")]).map(|s| s.trim().to_string());
    clean && ahead.is_ok_and(|n| n == "0")
}

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
    fn pristine_until_changed_or_committed() {
        let root = std::env::temp_dir().join(format!("claude-storm-pristine-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let repo = root.join("repo");
        fs::create_dir_all(&repo).unwrap();
        run_git(&repo, &["init", "-q", "-b", "main"]).unwrap();
        run_git(&repo, &["config", "user.email", "t@t"]).unwrap();
        run_git(&repo, &["config", "user.name", "t"]).unwrap();
        fs::write(repo.join("a.txt"), "one\n").unwrap();
        run_git(&repo, &["add", "."]).unwrap();
        run_git(&repo, &["commit", "-qm", "init"]).unwrap();

        let wt = root.join("wt");
        add(&repo, &wt, "pristine-test").unwrap();
        assert!(is_pristine(&wt, "main"));
        fs::write(wt.join("a.txt"), "two\n").unwrap();
        assert!(!is_pristine(&wt, "main"));
        commit(&wt, "change").unwrap();
        assert!(!is_pristine(&wt, "main"));
        let _ = fs::remove_dir_all(root);
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
        add(&repo, &wt, "session-test").unwrap();
        fs::write(wt.join("a.txt"), "two\n").unwrap();
        fs::write(wt.join("b.txt"), "new\n").unwrap();
        let d = diff(&wt, "main").unwrap();
        assert!(d.contains("+two") && d.contains("b.txt"), "{d}");
        assert!(commit(&wt, "change").unwrap());
        assert!(!commit(&wt, "noop").unwrap());
        merge(&repo, "main", "session-test").unwrap();
        assert_eq!(fs::read_to_string(repo.join("a.txt")).unwrap(), "two\n");
        remove(&repo, &wt, "session-test", true).unwrap();
        assert!(!wt.exists());
        let _ = fs::remove_dir_all(root);
    }
}
