use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use crate::error::AppError;
use crate::usage::parser::{parse_usage, UsageBar};
use crate::usage::probe;

/// Minimum age before a cached snapshot is refreshed automatically.
const MAX_AGE_SECS: i64 = 600;

pub const USAGE_UPDATED: &str = "usage-updated";

/// How Claude is authenticated for a usage query.
#[derive(Debug, Clone)]
pub struct UsageTarget {
    pub key: String,
    pub env: HashMap<String, String>,
    pub remove_env: Vec<&'static str>,
    pub cwd: PathBuf,
    pub api_key: bool,
}

/// Last known plan usage for one profile.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub profile_key: String,
    pub fetched_at: DateTime<Utc>,
    pub bars: Vec<UsageBar>,
    pub raw_screen: String,
    pub error: Option<String>,
    pub billing: &'static str,
}

/// Per-profile cache with single-flight refreshes.
#[derive(Default)]
pub struct UsageService {
    cache: Mutex<HashMap<String, UsageSnapshot>>,
    locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

impl UsageService {
    /// Returns the cached snapshot for a profile, if any.
    pub fn cached(&self, key: &str) -> Option<UsageSnapshot> {
        self.cache.lock().unwrap().get(key).cloned()
    }

    /// Returns fresh-enough data, querying Claude Code at most once at a time per profile.
    pub async fn get<R: Runtime>(&self, app: &AppHandle<R>, target: UsageTarget, force: bool) -> UsageSnapshot {
        if target.api_key {
            return UsageSnapshot {
                profile_key: target.key,
                fetched_at: Utc::now(),
                bars: Vec::new(),
                raw_screen: String::new(),
                error: None,
                billing: "api",
            };
        }
        let lock = self.locks.lock().unwrap().entry(target.key.clone()).or_default().clone();
        let started = Utc::now();
        let _guard = lock.lock().await;
        if let Some(snapshot) = self.cached(&target.key) {
            let fresh = (Utc::now() - snapshot.fetched_at).num_seconds() < MAX_AGE_SECS;
            if (!force && fresh) || snapshot.fetched_at >= started {
                return snapshot;
            }
        }
        let snapshot = fetch(target).await;
        self.cache.lock().unwrap().insert(snapshot.profile_key.clone(), snapshot.clone());
        let _ = app.emit(USAGE_UPDATED, &snapshot);
        snapshot
    }
}

/// Runs the PTY probe on a blocking thread and parses the result.
async fn fetch(target: UsageTarget) -> UsageSnapshot {
    let key = target.key.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let claude = crate::shell_env::which("claude").ok_or_else(|| AppError::msg("The `claude` CLI was not found in PATH."))?;
        probe::run(&claude, &target.cwd, &target.env, &target.remove_env)
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))
    .and_then(|r| r);
    let now = Utc::now();
    match result {
        Ok(out) => {
            let bars = parse_usage(&out.screen, now);
            let error = bars.is_empty().then(|| "Could not parse the /usage output; showing raw text.".to_string());
            UsageSnapshot { profile_key: key, fetched_at: now, bars, raw_screen: out.screen, error, billing: "subscription" }
        }
        Err(err) => UsageSnapshot {
            profile_key: key,
            fetched_at: now,
            bars: Vec::new(),
            raw_screen: String::new(),
            error: Some(err.to_string()),
            billing: "subscription",
        },
    }
}
