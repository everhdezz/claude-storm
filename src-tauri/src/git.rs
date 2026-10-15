use std::path::Path;

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::shell_env;

/// Snapshot of a repository's working tree.
#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub staged: u32,
    pub modified: u32,
    pub untracked: u32,
    pub conflicted: u32,
    /// Lines added/removed against HEAD, untracked files included.
    pub insertions: u32,
    pub deletions: u32,
}

/// Runs git in a directory and returns stdout, failing with stderr on a non-zero exit.
pub fn run_git(dir: &Path, args: &[&str]) -> AppResult<String> {
    let output = shell_env::command("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(std::process::Stdio::null())
        .output()?;
    if !output.status.success() {
        return Err(AppError::msg(String::from_utf8_lossy(&output.stderr).trim().to_string()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Reads branch and change counts using porcelain v2 output.
pub fn status(dir: &Path) -> AppResult<GitStatus> {
    let out = run_git(dir, &["status", "--porcelain=v2", "--branch", "--untracked-files=all"])?;
    let mut s = parse_status(&out);
    let (ins, del) = parse_shortstat(&run_git(dir, &["diff", "HEAD", "--shortstat"]).unwrap_or_default());
    s.insertions = ins + untracked_lines(dir, &out);
    s.deletions = del;
    Ok(s)
}

/// Reads "N insertions(+), M deletions(-)" from `git diff --shortstat`.
pub fn parse_shortstat(out: &str) -> (u32, u32) {
    let (mut ins, mut del) = (0, 0);
    for part in out.split(',') {
        let mut words = part.split_whitespace();
        let (Some(n), Some(kind)) = (words.next(), words.next()) else { continue };
        let n: u32 = n.parse().unwrap_or(0);
        if kind.starts_with("insertion") {
            ins = n;
        } else if kind.starts_with("deletion") {
            del = n;
        }
    }
    (ins, del)
}

/// Counts lines of untracked text files (skipping big or binary ones) so new files show up as additions.
fn untracked_lines(dir: &Path, porcelain: &str) -> u32 {
    const MAX_BYTES: u64 = 1024 * 1024;
    porcelain
        .lines()
        .filter_map(|l| l.strip_prefix("? "))
        .take(2000)
        .filter_map(|rel| {
            let path = dir.join(rel);
            if std::fs::metadata(&path).ok()?.len() > MAX_BYTES {
                return None;
            }
            let bytes = std::fs::read(&path).ok()?;
            if bytes.contains(&0) {
                return None;
            }
            let lines = bytes.iter().filter(|&&b| b == b'\n').count() + usize::from(bytes.last().is_some_and(|&b| b != b'\n'));
            Some(lines as u32)
        })
        .sum()
}

/// Parses `git status --porcelain=v2 --branch`.
pub fn parse_status(out: &str) -> GitStatus {
    let mut s = GitStatus::default();
    for line in out.lines() {
        if let Some(head) = line.strip_prefix("# branch.head ") {
            s.branch = (head != "(detached)").then(|| head.to_string());
        } else if let Some(ab) = line.strip_prefix("# branch.ab ") {
            for part in ab.split_whitespace() {
                if let Some(n) = part.strip_prefix('+') {
                    s.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix('-') {
                    s.behind = n.parse().unwrap_or(0);
                }
            }
        } else if line.starts_with("? ") {
            s.untracked += 1;
        } else if line.starts_with("u ") {
            s.conflicted += 1;
        } else if line.starts_with("1 ") || line.starts_with("2 ") {
            let xy = line.as_bytes().get(2..4).unwrap_or(b"..");
            if xy[0] != b'.' {
                s.staged += 1;
            }
            if xy[1] != b'.' {
                s.modified += 1;
            }
        }
    }
    s
}

/// A local or remote branch as listed in the branches popup.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    /// Short name: `main` for locals, `origin/main` for remotes.
    pub name: String,
    pub remote: bool,
    pub current: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// Folder of another worktree that has this branch checked out (git refuses to check it out here).
    pub worktree: Option<String>,
    pub committed_at: Option<i64>,
}

/// Every branch of a repo plus the recently checked out ones, newest first.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BranchList {
    pub current: Option<String>,
    pub recent: Vec<String>,
    pub branches: Vec<BranchInfo>,
}

const REF_FORMAT: &str = "%(refname)%00%(HEAD)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(worktreepath)%00%(committerdate:unix)";

/// Lists local and remote branches, marking the current one and those held by other worktrees.
pub fn branches(dir: &Path) -> AppResult<BranchList> {
    let refs = run_git(dir, &["for-each-ref", &format!("--format={REF_FORMAT}"), "refs/heads", "refs/remotes"])?;
    let branches = parse_branches(&refs);
    let current = branches.iter().find(|b| b.current).map(|b| b.name.clone());
    let reflog = run_git(dir, &["reflog", "show", "--format=%gs", "-n", "300"]).unwrap_or_default();
    let locals: Vec<&str> = branches.iter().filter(|b| !b.remote).map(|b| b.name.as_str()).collect();
    let recent = parse_recent(&reflog, current.as_deref(), &locals, 5);
    Ok(BranchList { current, recent, branches })
}

/// Parses `git for-each-ref` output produced with [`REF_FORMAT`].
pub fn parse_branches(out: &str) -> Vec<BranchInfo> {
    let mut list = Vec::new();
    for line in out.lines() {
        let f: Vec<&str> = line.split('\0').collect();
        let [refname, head, upstream, track, worktree, date] = f[..] else { continue };
        let (name, remote) = if let Some(n) = refname.strip_prefix("refs/heads/") {
            (n, false)
        } else if let Some(n) = refname.strip_prefix("refs/remotes/") {
            if n.ends_with("/HEAD") {
                continue;
            }
            (n, true)
        } else {
            continue;
        };
        let current = head == "*";
        let (mut ahead, mut behind) = (0, 0);
        for part in track.split(", ") {
            if let Some(n) = part.strip_prefix("ahead ") {
                ahead = n.parse().unwrap_or(0);
            } else if let Some(n) = part.strip_prefix("behind ") {
                behind = n.parse().unwrap_or(0);
            }
        }
        list.push(BranchInfo {
            name: name.to_string(),
            remote,
            current,
            upstream: (!upstream.is_empty()).then(|| upstream.to_string()),
            ahead,
            behind,
            worktree: (!current && !worktree.is_empty()).then(|| worktree.to_string()),
            committed_at: date.parse().ok(),
        });
    }
    list
}

/// Branches reached by "checkout: moving from A to B" reflog entries, newest first.
pub fn parse_recent(reflog: &str, current: Option<&str>, locals: &[&str], limit: usize) -> Vec<String> {
    let mut recent: Vec<String> = Vec::new();
    for line in reflog.lines() {
        let Some(rest) = line.strip_prefix("checkout: moving from ") else { continue };
        let Some((from, _)) = rest.split_once(" to ") else { continue };
        if Some(from) != current && locals.contains(&from) && !recent.iter().any(|r| r == from) {
            recent.push(from.to_string());
        }
        if recent.len() >= limit {
            break;
        }
    }
    recent
}

/// Checks out a local branch, or creates a tracking branch for a remote one (reusing a local of the same name).
pub fn checkout(dir: &Path, name: &str, remote: bool) -> AppResult<()> {
    if !remote {
        run_git(dir, &["checkout", name])?;
        return Ok(());
    }
    let local = name.split_once('/').map_or(name, |(_, rest)| rest);
    if run_git(dir, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{local}")]).is_ok() {
        run_git(dir, &["checkout", local])?;
    } else {
        run_git(dir, &["checkout", "--track", name])?;
    }
    Ok(())
}

/// Creates a branch from `start` (HEAD when empty) and optionally checks it out.
pub fn create_branch(dir: &Path, name: &str, start: Option<&str>, checkout: bool) -> AppResult<()> {
    let start = start.filter(|s| !s.is_empty()).unwrap_or("HEAD");
    if checkout {
        run_git(dir, &["checkout", "-b", name, start])?;
    } else {
        run_git(dir, &["branch", name, start])?;
    }
    Ok(())
}

#[cfg(test)]
mod branch_tests {
    use super::*;

    #[test]
    fn parses_refs() {
        let out = "refs/heads/main\0*\0origin/main\0ahead 2, behind 1\0/repo\01700000000\n\
refs/heads/feat\0 \0\0\0/wt/feat\01700000001\n\
refs/remotes/origin/HEAD\0 \0\0\0\01700000000\n\
refs/remotes/origin/main\0 \0\0\0\01700000000\n";
        let list = parse_branches(out);
        assert_eq!(list.len(), 3);
        assert!(list[0].current && list[0].worktree.is_none());
        assert_eq!((list[0].ahead, list[0].behind), (2, 1));
        assert_eq!(list[1].worktree.as_deref(), Some("/wt/feat"));
        assert!(list[2].remote && list[2].name == "origin/main");
    }

    #[test]
    fn recent_from_reflog() {
        let reflog = "checkout: moving from feat to main\ncommit: x\ncheckout: moving from main to feat\ncheckout: moving from old to main\n";
        assert_eq!(parse_recent(reflog, Some("main"), &["main", "feat"], 5), vec!["feat"]);
    }
}

#[cfg(test)]
mod tests {
    use super::parse_status;

    #[test]
    fn parses_branch_and_counts() {
        let out = "# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n\
1 .M N... 100644 100644 100644 a b src/a.ts\n1 M. N... 100644 100644 100644 a b src/b.ts\n\
1 MM N... 100644 100644 100644 a b src/c.ts\n? new.txt\nu UU N... 1 2 3 4 a b c x.ts\n";
        let s = parse_status(out);
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!((s.ahead, s.behind), (2, 1));
        assert_eq!((s.staged, s.modified, s.untracked, s.conflicted), (2, 2, 1, 1));
    }

    #[test]
    fn parses_shortstat() {
        assert_eq!(super::parse_shortstat(" 3 files changed, 12 insertions(+), 4 deletions(-)\n"), (12, 4));
        assert_eq!(super::parse_shortstat(" 1 file changed, 1 deletion(-)\n"), (0, 1));
        assert_eq!(super::parse_shortstat(""), (0, 0));
    }

    #[test]
    fn detached_head_has_no_branch() {
        assert_eq!(parse_status("# branch.head (detached)\n").branch, None);
    }
}
