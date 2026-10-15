use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use crate::error::AppResult;
use crate::sessions::stream::ChatItem;

/// Per-session JSONL history files, kept outside the main JSON document.
pub struct History {
    dir: PathBuf,
}

impl History {
    /// Uses `<app data>/sessions` as storage.
    pub fn new(app_data: &Path) -> Self {
        Self { dir: app_data.join("sessions") }
    }

    /// Path of a session's history file.
    fn file(&self, session_id: &str) -> PathBuf {
        self.dir.join(format!("{session_id}.jsonl"))
    }

    /// Appends items to a session's history.
    pub fn append(&self, session_id: &str, items: &[ChatItem]) -> AppResult<()> {
        if items.is_empty() {
            return Ok(());
        }
        fs::create_dir_all(&self.dir)?;
        let mut file = OpenOptions::new().create(true).append(true).open(self.file(session_id))?;
        for item in items {
            writeln!(file, "{}", serde_json::to_string(item)?)?;
        }
        Ok(())
    }

    /// Reads every item of a session, skipping corrupt lines.
    pub fn read(&self, session_id: &str) -> AppResult<Vec<ChatItem>> {
        let path = self.file(session_id);
        if !path.exists() {
            return Ok(Vec::new());
        }
        let reader = BufReader::new(fs::File::open(path)?);
        Ok(reader.lines().map_while(Result::ok).filter_map(|l| serde_json::from_str(&l).ok()).collect())
    }

    /// Copies the history of one session to another (duplicate).
    pub fn copy(&self, from: &str, to: &str) -> AppResult<()> {
        if self.file(from).exists() {
            fs::create_dir_all(&self.dir)?;
            fs::copy(self.file(from), self.file(to))?;
        }
        Ok(())
    }

    /// Deletes a session's history.
    pub fn remove(&self, session_id: &str) {
        let _ = fs::remove_file(self.file(session_id));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_and_reads_back() {
        let dir = std::env::temp_dir().join(format!("claude-storm-history-{}", std::process::id()));
        let history = History::new(&dir);
        history.append("s1", &[ChatItem::Text { text: "a".into() }]).unwrap();
        history.append("s1", &[ChatItem::Notice { level: "info".into(), text: "b".into() }]).unwrap();
        assert_eq!(history.read("s1").unwrap().len(), 2);
        history.copy("s1", "s2").unwrap();
        assert_eq!(history.read("s2").unwrap().len(), 2);
        history.remove("s1");
        assert!(history.read("s1").unwrap().is_empty());
        let _ = fs::remove_dir_all(dir);
    }
}
