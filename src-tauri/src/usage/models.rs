//! Reads the model list Claude Code exposes in its `/model` picker.

use regex::Regex;
use serde::{Deserialize, Serialize};

/// A model offered by the installed Claude Code.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogModel {
    pub id: String,
    pub label: String,
    pub description: String,
}

/// Parses picker rows ("3.  Fable 5.1   For your toughest challenges"), skipping the "Default" entry.
pub fn parse_picker(screen: &str) -> Vec<(u32, CatalogModel)> {
    let row = Regex::new(r"^\s*(?:❯|↓|↑)?\s*(\d+)\.\s+(.+?)\s{2,}(.+?)\s*$").unwrap();
    let name = Regex::new(r"^(Opus|Sonnet|Haiku|Fable)\s+(\d+(?:\.\d+)?)$").unwrap();
    let mut out = Vec::new();
    for line in screen.lines() {
        let Some(c) = row.captures(line) else { continue };
        let label = c[2].trim();
        let Some(n) = name.captures(label) else { continue };
        let id = format!("claude-{}-{}", n[1].to_lowercase(), n[2].replace('.', "-"));
        out.push((
            c[1].parse().unwrap_or(0),
            CatalogModel { id, label: label.to_string(), description: c[3].trim().to_string() },
        ));
    }
    out
}

/// Merges rows seen while scrolling the picker, ordered by their number.
pub fn merge_rows(rows: Vec<(u32, CatalogModel)>) -> Vec<CatalogModel> {
    let mut sorted = rows;
    sorted.sort_by_key(|(n, _)| *n);
    let mut seen = std::collections::HashSet::new();
    sorted.into_iter().filter(|(_, m)| seen.insert(m.id.clone())).map(|(_, m)| m).collect()
}

/// Models known for Claude Code 2.1.x, used until the picker is read.
pub fn fallback_catalog() -> Vec<CatalogModel> {
    [
        ("claude-opus-5-5", "Opus 5.5", "For complex work and everyday tasks"),
        ("claude-fable-5-1", "Fable 5.1", "For your toughest challenges"),
        ("claude-sonnet-5-5", "Sonnet 5.5", "Most efficient for simpler tasks"),
        ("claude-haiku-5-5", "Haiku 5.5", "Fastest for quick answers"),
    ]
    .iter()
    .map(|(id, label, description)| CatalogModel { id: id.to_string(), label: label.to_string(), description: description.to_string() })
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_real_picker_and_derives_ids() {
        let models = merge_rows(parse_picker(include_str!("../../tests/fixtures/model/picker.txt")));
        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "claude-opus-5-5",
                "claude-fable-5-1",
                "claude-sonnet-5-5",
                "claude-haiku-5-5",
                "claude-haiku-4-5",
                "claude-sonnet-5",
                "claude-opus-5",
                "claude-fable-5",
                "claude-opus-4-8"
            ]
        );
        assert_eq!(models[1].label, "Fable 5.1");
        assert_eq!(models[1].description, "For your toughest challenges");
    }
}
