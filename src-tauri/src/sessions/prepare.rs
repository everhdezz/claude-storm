//! Makes a fresh worktree runnable: copies git-ignored env files and clones dependency folders
//! from the main checkout, so services start without a full reinstall.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

use crate::git::run_git;
use crate::i18n::tr;

/// Ignored folders cloned from the main checkout (copy-on-write where the filesystem allows it).
const DEPENDENCY_DIRS: &[&str] = &["node_modules", "vendor"];

/// Lockfiles compared to tell whether the cloned dependencies may be stale.
const LOCKFILES: &[&str] = &["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock", "composer.lock"];

/// What was done for one repo, summarized for the session's chat.
#[derive(Debug, Default, PartialEq)]
pub struct PrepareReport {
    pub env_files: Vec<String>,
    pub dependency_dirs: Vec<String>,
    pub stale_lockfiles: Vec<String>,
    pub errors: Vec<String>,
    pub millis: u128,
}

impl PrepareReport {
    /// One line for the chat, e.g. "web: copié .env · cloné node_modules (1.2 s)".
    pub fn summary(&self, repo_name: &str) -> Option<String> {
        let mut parts = Vec::new();
        if !self.env_files.is_empty() {
            parts.push(format!("{} {}", tr("copied", "copié"), self.env_files.join(", ")));
        }
        if !self.dependency_dirs.is_empty() {
            parts.push(format!("{} {}", tr("cloned", "cloné"), self.dependency_dirs.join(", ")));
        }
        if parts.is_empty() && self.errors.is_empty() && self.stale_lockfiles.is_empty() {
            return None;
        }
        let mut line = format!("{repo_name}: {}", if parts.is_empty() { tr("nothing to copy", "nada que copiar") } else { parts.join(" · ") });
        line.push_str(&format!(" ({:.1} s)", self.millis as f64 / 1000.0));
        if !self.stale_lockfiles.is_empty() {
            line.push_str(&format!(
                ". {} {}",
                self.stale_lockfiles.join(", "),
                tr(
                    "differs from the main checkout: run install before starting services",
                    "es distinto al del principal: corre install antes de levantar servicios"
                )
            ));
        }
        for err in &self.errors {
            line.push_str(&format!(". {} {err}", tr("Could not copy", "No pude copiar")));
        }
        Some(line)
    }
}

/// Copies env files and clones dependency folders from `repo` into the new worktree `wt`.
pub fn prepare(repo: &Path, wt: &Path) -> PrepareReport {
    let started = Instant::now();
    let mut report = PrepareReport::default();
    let ignored = run_git(repo, &["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"]).unwrap_or_default();
    let (env_files, dep_dirs) = classify_ignored(&ignored);

    for rel in env_files {
        let target = wt.join(&rel);
        if target.exists() {
            continue;
        }
        let copied = target.parent().map_or(Ok(()), std::fs::create_dir_all).and_then(|_| std::fs::copy(repo.join(&rel), &target));
        match copied {
            Ok(_) => report.env_files.push(rel),
            Err(e) => report.errors.push(format!("{rel} ({e})")),
        }
    }

    for rel in dep_dirs {
        let target = wt.join(&rel);
        if target.exists() || !target.parent().is_some_and(Path::exists) {
            continue;
        }
        match clone_dir(&repo.join(&rel), &target) {
            Ok(()) => report.dependency_dirs.push(rel),
            Err(e) => report.errors.push(format!("{rel} ({e})")),
        }
    }

    report.stale_lockfiles = LOCKFILES
        .iter()
        .filter(|name| {
            let (a, b) = (std::fs::read(repo.join(name)), std::fs::read(wt.join(name)));
            matches!((a, b), (Ok(a), Ok(b)) if a != b)
        })
        .map(|s| s.to_string())
        .collect();
    report.millis = started.elapsed().as_millis();
    report
}

/// Splits `git ls-files --others --ignored --directory` output into env files and dependency folders.
/// Paths inside dependency folders are never treated as env files.
pub fn classify_ignored(out: &str) -> (Vec<String>, Vec<String>) {
    let mut env_files = Vec::new();
    let mut dep_dirs = Vec::new();
    for line in out.lines().map(str::trim).filter(|l| !l.is_empty()) {
        if let Some(dir) = line.strip_suffix('/') {
            let name = dir.rsplit('/').next().unwrap_or(dir);
            let nested_in_dep = dir.split('/').rev().skip(1).any(|part| DEPENDENCY_DIRS.contains(&part));
            if DEPENDENCY_DIRS.contains(&name) && !nested_in_dep {
                dep_dirs.push(dir.to_string());
            }
            continue;
        }
        let name = line.rsplit('/').next().unwrap_or(line);
        let in_dep = line.split('/').any(|part| DEPENDENCY_DIRS.contains(&part));
        if !in_dep && (name == ".env" || name.starts_with(".env.")) {
            env_files.push(line.to_string());
        }
    }
    (env_files, dep_dirs)
}

/// Recursively copies a folder; uses APFS clones on macOS and reflinks on Linux when available.
fn clone_dir(from: &Path, to: &PathBuf) -> std::io::Result<()> {
    let mut cmd = if cfg!(target_os = "macos") {
        let mut c = Command::new("cp");
        c.arg("-c").arg("-R");
        c
    } else if cfg!(target_os = "linux") {
        let mut c = Command::new("cp");
        c.arg("--reflink=auto").arg("-R");
        c
    } else {
        let mut c = Command::new("xcopy");
        c.args(["/E", "/I", "/Q", "/H"]);
        c
    };
    let out = cmd.arg(from).arg(to).output()?;
    if out.status.success() {
        Ok(())
    } else {
        Err(std::io::Error::other(String::from_utf8_lossy(&out.stderr).trim().to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn classifies_env_files_and_dependency_dirs() {
        let out = ".env\n.env.local\napps/web/.env.development\nnode_modules/\napps/web/node_modules/\nvendor/\nnode_modules/foo/vendor/\nstorage/logs/\n.envrc\n.DS_Store\n";
        let (env, deps) = classify_ignored(out);
        assert_eq!(env, vec![".env", ".env.local", "apps/web/.env.development"]);
        assert_eq!(deps, vec!["node_modules", "apps/web/node_modules", "vendor"]);
    }

    #[test]
    fn prepares_a_real_worktree() {
        let root = std::env::temp_dir().join(format!("claude-storm-prepare-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let repo = root.join("repo");
        fs::create_dir_all(repo.join("node_modules/pkg")).unwrap();
        run_git(&repo, &["init", "-q", "-b", "main"]).unwrap();
        run_git(&repo, &["config", "user.email", "t@t"]).unwrap();
        run_git(&repo, &["config", "user.name", "t"]).unwrap();
        fs::write(repo.join(".gitignore"), ".env\nnode_modules/\n").unwrap();
        fs::write(repo.join("package-lock.json"), "v1").unwrap();
        run_git(&repo, &["add", "."]).unwrap();
        run_git(&repo, &["commit", "-qm", "init"]).unwrap();
        fs::write(repo.join(".env"), "SECRET=1").unwrap();
        fs::write(repo.join("node_modules/pkg/index.js"), "x").unwrap();
        fs::write(repo.join("package-lock.json"), "v2").unwrap();

        let wt = root.join("wt");
        crate::sessions::worktree::add(&repo, &wt, "prepare-test").unwrap();
        let report = prepare(&repo, &wt);
        assert_eq!(report.env_files, vec![".env"]);
        assert_eq!(report.dependency_dirs, vec!["node_modules"]);
        assert_eq!(report.stale_lockfiles, vec!["package-lock.json"]);
        assert_eq!(fs::read_to_string(wt.join(".env")).unwrap(), "SECRET=1");
        assert!(wt.join("node_modules/pkg/index.js").exists());
        assert!(report.summary("repo").unwrap().contains("cloned node_modules"));
        let _ = fs::remove_dir_all(root);
    }
}
