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
    pub accept_trust: bool,
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

impl UsageService {
    /// Updates the default snapshot from the usage Claude Code reports inline after each request.
    pub fn apply_rate_windows<R: Runtime>(&self, app: &AppHandle<R>, key: &str, windows: &[crate::sessions::stream::RateWindow]) {
        let mut cache = self.cache.lock().unwrap();
        let snapshot = cache.entry(key.into()).or_insert_with(|| UsageSnapshot {
            profile_key: key.into(),
            fetched_at: Utc::now(),
            bars: Vec::new(),
            raw_screen: String::new(),
            error: None,
            billing: "subscription",
        });
        for w in windows {
            let label = match w.key.as_str() {
                "five_hour" => "Current session",
                "seven_day" => "Current week (all models)",
                _ => continue,
            };
            let percent = (w.utilization * 100.0).round().clamp(0.0, 100.0) as u8;
            match snapshot.bars.iter_mut().find(|b| b.label == label) {
                Some(bar) => {
                    bar.percent = percent;
                    if w.resets_at.is_some() {
                        bar.resets_at = w.resets_at;
                    }
                }
                None => snapshot.bars.push(UsageBar { label: label.into(), percent, resets_text: None, resets_at: w.resets_at }),
            }
        }
        snapshot.fetched_at = Utc::now();
        snapshot.error = None;
        let _ = app.emit(USAGE_UPDATED, &*snapshot);
    }
}

/// Runs the PTY probe on a blocking thread and parses the result.
async fn fetch(target: UsageTarget) -> UsageSnapshot {
    let key = target.key.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let claude = crate::shell_env::which("claude").ok_or_else(|| AppError::msg("The `claude` CLI was not found in PATH."))?;
        std::fs::create_dir_all(&target.cwd)?;
        probe::run(&claude, &target.cwd, &target.env, &target.remove_env, target.accept_trust)
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
        Err(err) => {
            let full = err.to_string();
            let (headline, rest) = full.split_once("\n\n").unwrap_or((full.as_str(), ""));
            UsageSnapshot {
                profile_key: key,
                fetched_at: now,
                bars: Vec::new(),
                raw_screen: rest.trim().to_string(),
                error: Some(headline.trim().to_string()),
                billing: "subscription",
            }
        }
    }
}
