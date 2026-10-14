//! Parser for the `/usage` screen of Claude Code. Kept isolated and fixture-tested so it is
//! easy to adjust when Claude Code changes the layout.

use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveTime, TimeZone, Utc};
use regex::Regex;
use serde::Serialize;

/// One usage bar shown by `/usage` (session window, weekly window, per-model limits...).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageBar {
    pub label: String,
    pub percent: u8,
    pub resets_text: Option<String>,
    pub resets_at: Option<DateTime<Utc>>,
}

/// Renders raw terminal bytes into the final screen text, as a human would see it.
pub fn render_screen(raw: &[u8], rows: u16, cols: u16) -> String {
    let mut parser = vt100::Parser::new(rows, cols, 0);
    parser.process(raw);
    parser.screen().contents()
}

/// Extracts every "<label> / N% used / Resets ..." block from the rendered screen.
pub fn parse_usage(screen: &str, now: DateTime<Utc>) -> Vec<UsageBar> {
    let used = Regex::new(r"(\d{1,3})\s*%\s*used\s*$").unwrap();
    let lines: Vec<&str> = screen.lines().map(str::trim).collect();
    let mut bars = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let Some(caps) = used.captures(line) else { continue };
        let percent: u8 = caps[1].parse::<u16>().unwrap_or(0).min(100) as u8;
        let Some(label) = lines[..i].iter().rev().find(|l| is_label(l)) else { continue };
        let resets_text = lines[i + 1..]
            .iter()
            .find(|l| !l.is_empty())
            .and_then(|l| l.strip_prefix("Resets"))
            .map(|t| t.trim().to_string());
        let resets_at = resets_text.as_deref().and_then(|t| parse_reset(t, now));
        bars.push(UsageBar { label: label.to_string(), percent, resets_text, resets_at });
    }
    bars
}

/// A label is the closest non-empty text line that is not itself a bar.
fn is_label(line: &str) -> bool {
    !line.is_empty() && !line.contains('%') && !line.starts_with("Resets") && line.chars().any(char::is_alphabetic)
}

/// Parses reset hints such as `3:30pm (America/Chihuahua)` or `Oct 17 at 4am (America/Chihuahua)`.
pub fn parse_reset(text: &str, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
    let re = Regex::new(
        r"(?i)^(?:(?P<mon>[a-z]{3})[a-z]*\s+(?P<day>\d{1,2})(?:,?\s*(?P<year>\d{4}))?\s+at\s+)?(?P<h>\d{1,2})(?::(?P<m>\d{2}))?\s*(?P<ampm>am|pm)\s*\((?P<tz>[^)]+)\)",
    )
    .unwrap();
    let caps = re.captures(text.trim())?;
    let tz: chrono_tz::Tz = caps["tz"].trim().parse().ok()?;
    let mut hour: u32 = caps["h"].parse().ok()?;
    let minute: u32 = caps.name("m").map_or(Some(0), |m| m.as_str().parse().ok())?;
    let pm = caps["ampm"].eq_ignore_ascii_case("pm");
    hour = match (hour, pm) {
        (12, false) => 0,
        (12, true) => 12,
        (h, true) => h + 12,
        (h, false) => h,
    };
    let time = NaiveTime::from_hms_opt(hour, minute, 0)?;
    let local_now = now.with_timezone(&tz);

    let date = match caps.name("mon") {
        Some(mon) => {
            let month = month_number(mon.as_str())?;
            let day: u32 = caps["day"].parse().ok()?;
            let year = caps.name("year").and_then(|y| y.as_str().parse().ok()).unwrap_or(local_now.year());
            let mut date = NaiveDate::from_ymd_opt(year, month, day)?;
            if caps.name("year").is_none() && date < local_now.date_naive() - Duration::days(1) {
                date = NaiveDate::from_ymd_opt(year + 1, month, day)?;
            }
            date
        }
        None => {
            let today = local_now.date_naive();
            if time > local_now.time() { today } else { today + Duration::days(1) }
        }
    };
    let local = tz.from_local_datetime(&date.and_time(time)).earliest()?;
    Some(local.with_timezone(&Utc))
}

/// Maps an English month abbreviation to its number.
fn month_number(name: &str) -> Option<u32> {
    let months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    let lower = name.to_ascii_lowercase();
    months.iter().position(|m| lower.starts_with(m)).map(|i| i as u32 + 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &[u8] = include_bytes!("../../tests/fixtures/usage/subscription-max.raw");

    /// 2026-10-14 12:00 in America/Chihuahua (UTC-6).
    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 14, 18, 0, 0).unwrap()
    }

    #[test]
    fn parses_real_subscription_screen() {
        let screen = render_screen(FIXTURE, 50, 120);
        let bars = parse_usage(&screen, now());
        let summary: Vec<_> = bars.iter().map(|b| (b.label.as_str(), b.percent)).collect();
        assert_eq!(
            summary,
            [("Current session", 32), ("Current week (all models)", 46), ("Current week (Fable)", 0)]
        );
        assert_eq!(bars[0].resets_text.as_deref(), Some("3:30pm (America/Chihuahua)"));
        assert_eq!(bars[0].resets_at, Some(Utc.with_ymd_and_hms(2026, 10, 14, 21, 30, 0).unwrap()));
        assert_eq!(bars[1].resets_at, Some(Utc.with_ymd_and_hms(2026, 10, 17, 10, 0, 0).unwrap()));
    }

    #[test]
    fn ignores_contribution_percentages() {
        let screen = render_screen(FIXTURE, 50, 120);
        assert!(parse_usage(&screen, now()).iter().all(|b| !b.label.contains("usage was")));
    }

    #[test]
    fn time_only_reset_already_passed_rolls_to_tomorrow() {
        let at = parse_reset("9am (America/Chihuahua)", now()).unwrap();
        assert_eq!(at, Utc.with_ymd_and_hms(2026, 10, 15, 15, 0, 0).unwrap());
    }

    #[test]
    fn handles_midnight_and_noon() {
        assert_eq!(parse_reset("12am (UTC)", now()), Some(Utc.with_ymd_and_hms(2026, 10, 15, 0, 0, 0).unwrap()));
        assert_eq!(parse_reset("Oct 20 at 12pm (UTC)", now()), Some(Utc.with_ymd_and_hms(2026, 10, 20, 12, 0, 0).unwrap()));
    }

    #[test]
    fn unknown_format_keeps_text_without_date() {
        let bars = parse_usage("Current session\n██ 10% used\nResets soon-ish\n", now());
        assert_eq!(bars[0].resets_text.as_deref(), Some("soon-ish"));
        assert_eq!(bars[0].resets_at, None);
    }

    #[test]
    fn unparseable_screen_yields_no_bars() {
        assert!(parse_usage("Welcome to Claude Code\n> ", now()).is_empty());
    }
}
