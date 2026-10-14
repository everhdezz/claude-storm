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
}

/// Runs git in a directory and returns stdout, failing with stderr on a non-zero exit.
pub fn run_git(dir: &Path, args: &[&str]) -> AppResult<String> {
    let output = shell_env::command("git").arg("-C").arg(dir).args(args).output()?;
    if !output.status.success() {
        return Err(AppError::msg(String::from_utf8_lossy(&output.stderr).trim().to_string()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Reads branch and change counts using porcelain v2 output.
pub fn status(dir: &Path) -> AppResult<GitStatus> {
    let out = run_git(dir, &["status", "--porcelain=v2", "--branch", "--untracked-files=all"])?;
    Ok(parse_status(&out))
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

impl GitStatus {
    /// Total files with any change, used for compact badges.
    pub fn changed_files(&self) -> u32 {
        self.staged.max(self.modified) + self.untracked + self.conflicted
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
    fn detached_head_has_no_branch() {
        assert_eq!(parse_status("# branch.head (detached)\n").branch, None);
    }
}
