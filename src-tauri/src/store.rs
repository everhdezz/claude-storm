use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::error::{AppError, AppResult};
use crate::models::{AppData, Project, Session, SessionStatus};

/// JSON-file backed store shared by every window through Tauri state.
pub struct Store {
    path: PathBuf,
    data: Mutex<AppData>,
}

impl Store {
    /// Loads the store from disk, starting empty when the file does not exist yet.

    pub fn load(dir: PathBuf) -> AppResult<Self> {
        fs::create_dir_all(&dir)?;
        let path = dir.join("claude-storm.json");
        let mut data: AppData = if path.exists() {
            let raw = fs::read_to_string(&path)?;
            serde_json::from_str(&raw).unwrap_or_else(|err| {
                let backup = dir.join("claude-storm.corrupt.json");
                let _ = fs::copy(&path, &backup);
                eprintln!("claude-storm.json could not be parsed ({err}); backed up to {backup:?}");
                AppData::default()
            })
        } else {
            AppData::default()
        };
        migrate_model_aliases(&mut data);
        migrate_token_accounts(&mut data);
        for session in &mut data.sessions {
            if matches!(session.status, SessionStatus::Working | SessionStatus::Queued) {
                session.status = SessionStatus::Interrupted;
            }
        }
        Ok(Self { path, data: Mutex::new(data) })
    }

    /// Runs a read-only closure against the current data.
    pub fn read<T>(&self, f: impl FnOnce(&AppData) -> T) -> T {
        let guard = self.data.lock().expect("store poisoned");
        f(&guard)
    }

    /// Runs a mutating closure and persists the result atomically.
    pub fn write<T>(&self, f: impl FnOnce(&mut AppData) -> AppResult<T>) -> AppResult<T> {
        let mut guard = self.data.lock().expect("store poisoned");
        let result = f(&mut guard)?;
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_string_pretty(&*guard)?)?;
        fs::rename(&tmp, &self.path)?;
        Ok(result)
    }

    /// Returns a clone of a project by id.
    pub fn project(&self, id: &str) -> AppResult<Project> {
        self.read(|d| d.projects.iter().find(|p| p.id == id).cloned())
            .ok_or_else(|| AppError::NotFound(format!("project {id}")))
    }
}

impl Store {
    /// Folder that holds claude-storm.json and the other app files.
    pub fn dir(&self) -> PathBuf {
        self.path.parent().map(PathBuf::from).unwrap_or_default()
    }

    /// Returns a clone of a session by id.
    pub fn session(&self, id: &str) -> AppResult<Session> {
        self.read(|d| d.sessions.iter().find(|s| s.id == id).cloned())
            .ok_or_else(|| AppError::NotFound(format!("session {id}")))
    }

    /// Mutates one session and persists, returning its updated copy.
    pub fn update_session(&self, id: &str, f: impl FnOnce(&mut Session)) -> AppResult<Session> {
        self.write(|d| {
            let session = d
                .sessions
                .iter_mut()
                .find(|s| s.id == id)
                .ok_or_else(|| AppError::NotFound(format!("session {id}")))?;
            f(session);
            Ok(session.clone())
        })
    }
}

/// Older versions stored subscription tokens; they become isolated profiles that need a login.
fn migrate_token_accounts(data: &mut AppData) {
    for account in &mut data.accounts {
        if account.kind == crate::models::AccountKind::OauthToken {
            crate::accounts::delete_secret(&account.id);
            account.kind = crate::models::AccountKind::Profile;
            account.token_hint = None;
            account.needs_login = true;
        }
    }
}

/// Maps legacy aliases (fable/opus/sonnet/haiku) saved by older versions to catalog ids.
fn migrate_model_aliases(data: &mut AppData) {
    let catalog: Vec<String> = data.settings.model_catalog.iter().map(|m| m.id.clone()).collect();
    let resolve = |value: &mut Option<String>| {
        if let Some(alias) = value.as_deref().filter(|v| ["fable", "opus", "sonnet", "haiku"].contains(v)) {
            *value = catalog.iter().find(|id| id.starts_with(&format!("claude-{alias}-"))).cloned();
        }
    };
    resolve(&mut data.settings.default_model);
    for account in &mut data.accounts {
        resolve(&mut account.default_model);
    }
}

/// Finds a mutable project by id inside the data document.
pub fn find_project_mut<'a>(data: &'a mut AppData, id: &str) -> AppResult<&'a mut Project> {
    data.projects
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| AppError::NotFound(format!("project {id}")))
}
