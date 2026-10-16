//! Normalizes Claude Code `--output-format stream-json` lines into chat items the UI renders.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Max characters of a tool result kept in history.
const MAX_RESULT_CHARS: usize = 20_000;

/// Tools whose `file_path` input means the session modified that file.
const EDIT_TOOLS: &[&str] = &["Edit", "Write", "MultiEdit", "NotebookEdit"];

/// One renderable entry of a session conversation (persisted as JSONL).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ChatItem {
    Prompt {
        text: String,
        model: Option<String>,
        #[serde(default)]
        account: Option<String>,
        #[serde(default)]
        attachments: Vec<String>,
        at: DateTime<Utc>,
    },
    Text { text: String },
    ToolUse { id: String, name: String, input: Value },
    ToolResult { tool_use_id: String, content: String, is_error: bool },
    Result {
        ok: bool,
        text: String,
        cost_usd: Option<f64>,
        duration_ms: Option<u64>,
        turns: Option<u64>,
        /// Prompt tokens sent, cache reads and writes included.
        #[serde(default)]
        input_tokens: Option<u64>,
        #[serde(default)]
        output_tokens: Option<u64>,
    },
    Notice { level: String, text: String },
}

/// Plan usage reported inline by Claude Code after each request.
#[derive(Debug, Clone, PartialEq)]
pub struct RateWindow {
    pub key: String,
    pub utilization: f64,
    pub resets_at: Option<DateTime<Utc>>,
}

/// What a single stream line means for claude-storm.
#[derive(Debug, Default, PartialEq)]
pub struct Parsed {
    pub items: Vec<ChatItem>,
    pub delta: Option<String>,
    /// Output tokens of an assistant message that just finished streaming.
    pub output_tokens: Option<u64>,
    pub started: bool,
    pub model: Option<String>,
    pub rate_windows: Vec<RateWindow>,
}

/// Parses one stdout line; unknown or malformed lines yield an empty result.
pub fn parse_line(line: &str) -> Parsed {
    let mut out = Parsed::default();
    let Ok(v) = serde_json::from_str::<Value>(line) else { return out };
    match v.get("type").and_then(Value::as_str) {
        Some("system") if v.get("subtype").and_then(Value::as_str) == Some("init") => {
            out.started = true;
            out.model = v.get("model").and_then(Value::as_str).map(str::to_string);
        }
        Some("stream_event") => {
            if v.pointer("/event/type").and_then(Value::as_str) == Some("message_delta") {
                out.output_tokens = v.pointer("/event/usage/output_tokens").and_then(Value::as_u64);
            }
            let delta = v.pointer("/event/delta");
            if delta.and_then(|d| d.get("type")).and_then(Value::as_str) == Some("text_delta") {
                out.delta = delta.and_then(|d| d.get("text")).and_then(Value::as_str).map(str::to_string);
            }
        }
        Some("assistant") => {
            for block in content_blocks(&v) {
                match block.get("type").and_then(Value::as_str) {
                    Some("text") => {
                        let text = block.get("text").and_then(Value::as_str).unwrap_or_default();
                        if !text.trim().is_empty() {
                            out.items.push(ChatItem::Text { text: text.to_string() });
                        }
                    }
                    Some("tool_use") => out.items.push(ChatItem::ToolUse {
                        id: str_field(block, "id"),
                        name: str_field(block, "name"),
                        input: block.get("input").cloned().unwrap_or(Value::Null),
                    }),
                    _ => {}
                }
            }
        }
        Some("user") => {
            for block in content_blocks(&v) {
                if block.get("type").and_then(Value::as_str) == Some("tool_result") {
                    out.items.push(ChatItem::ToolResult {
                        tool_use_id: str_field(block, "tool_use_id"),
                        content: truncate(&result_text(block.get("content"))),
                        is_error: block.get("is_error").and_then(Value::as_bool).unwrap_or(false),
                    });
                }
            }
        }
        Some("result") => {
            let ok = !v.get("is_error").and_then(Value::as_bool).unwrap_or(false)
                && v.get("subtype").and_then(Value::as_str) == Some("success");
            out.items.push(ChatItem::Result {
                ok,
                text: v.get("result").and_then(Value::as_str).unwrap_or_default().to_string(),
                cost_usd: v.get("total_cost_usd").and_then(Value::as_f64),
                duration_ms: v.get("duration_ms").and_then(Value::as_u64),
                turns: v.get("num_turns").and_then(Value::as_u64),
                input_tokens: v.get("usage").map(|u| {
                    ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]
                        .iter()
                        .filter_map(|k| u.get(*k).and_then(Value::as_u64))
                        .sum()
                }),
                output_tokens: v.pointer("/usage/output_tokens").and_then(Value::as_u64),
            });
        }
        Some("rate_limit_event") => {
            if let Some(windows) = v.pointer("/rate_limit_info/unifiedWindows").and_then(Value::as_object) {
                for (key, w) in windows {
                    let Some(utilization) = w.get("utilization").and_then(Value::as_f64) else { continue };
                    let resets_at = w.get("resetsAt").and_then(Value::as_i64).and_then(|s| DateTime::from_timestamp(s, 0));
                    out.rate_windows.push(RateWindow { key: key.clone(), utilization, resets_at });
                }
            }
        }
        _ => {}
    }
    out
}

/// File paths modified by an edit-like tool call.
pub fn edited_file(item: &ChatItem) -> Option<String> {
    match item {
        ChatItem::ToolUse { name, input, .. } if EDIT_TOOLS.contains(&name.as_str()) => {
            input.get("file_path").or_else(|| input.get("notebook_path")).and_then(Value::as_str).map(str::to_string)
        }
        _ => None,
    }
}

/// Content blocks of an assistant/user message line.
fn content_blocks(v: &Value) -> Vec<&Value> {
    v.pointer("/message/content").and_then(Value::as_array).map(|a| a.iter().collect()).unwrap_or_default()
}

/// Reads a string field or returns an empty string.
fn str_field(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}

/// Flattens a tool_result content (string or array of text blocks).
fn result_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// Caps very large tool outputs.
fn truncate(text: &str) -> String {
    if text.chars().count() <= MAX_RESULT_CHARS {
        return text.to_string();
    }
    let cut: String = text.chars().take(MAX_RESULT_CHARS).collect();
    format!("{cut}\n… (truncated)")
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("../../tests/fixtures/stream/read-file.jsonl");

    fn parse_all() -> Vec<Parsed> {
        FIXTURE.lines().map(parse_line).collect()
    }

    #[test]
    fn real_run_produces_tool_use_result_text_and_final_result() {
        let items: Vec<ChatItem> = parse_all().into_iter().flat_map(|p| p.items).collect();
        let kinds: Vec<&str> = items
            .iter()
            .map(|i| match i {
                ChatItem::ToolUse { .. } => "tool_use",
                ChatItem::ToolResult { .. } => "tool_result",
                ChatItem::Text { .. } => "text",
                ChatItem::Result { .. } => "result",
                _ => "other",
            })
            .collect();
        assert_eq!(kinds, ["tool_use", "tool_result", "text", "result"]);
        assert!(matches!(&items[0], ChatItem::ToolUse { name, .. } if name == "Read"));
        assert!(matches!(&items[1], ChatItem::ToolResult { content, is_error: false, .. } if content.contains("hola")));
        assert!(matches!(&items[3], ChatItem::Result { ok: true, text, .. } if text == "hola"));
        assert!(matches!(
            &items[3],
            ChatItem::Result { input_tokens: Some(45_511), output_tokens: Some(116), .. }
        ));
    }

    #[test]
    fn detects_init_deltas_and_rate_limits() {
        let parsed = parse_all();
        assert!(parsed.iter().any(|p| p.started));
        assert!(parsed.iter().any(|p| p.model.as_deref() == Some("claude-haiku-5-5")));
        let text: String = parsed.iter().filter_map(|p| p.delta.clone()).collect();
        assert_eq!(text, "hola");
        let tokens: Vec<u64> = parsed.iter().filter_map(|p| p.output_tokens).collect();
        assert_eq!(tokens, [112, 4]);
        let windows: Vec<_> = parsed.iter().flat_map(|p| p.rate_windows.clone()).collect();
        let five = windows.iter().find(|w| w.key == "five_hour").unwrap();
        assert!((five.utilization - 0.02).abs() < 1e-9);
        assert!(five.resets_at.is_some());
        assert!(windows.iter().any(|w| w.key == "seven_day"));
    }

    #[test]
    fn edit_tools_report_their_file() {
        let edit = ChatItem::ToolUse { id: "1".into(), name: "Edit".into(), input: serde_json::json!({"file_path": "/a.ts"}) };
        let read = ChatItem::ToolUse { id: "2".into(), name: "Read".into(), input: serde_json::json!({"file_path": "/a.ts"}) };
        assert_eq!(edited_file(&edit).as_deref(), Some("/a.ts"));
        assert_eq!(edited_file(&read), None);
    }

    #[test]
    fn garbage_is_ignored() {
        assert_eq!(parse_line("not json"), Parsed::default());
        assert_eq!(parse_line("{\"type\":\"mystery\"}"), Parsed::default());
    }
}
