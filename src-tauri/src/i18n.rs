//! Language of the few user-facing texts the backend writes itself (chat notices, login errors).
//! The UI reports the active language at startup; English is the default.

use std::sync::atomic::{AtomicBool, Ordering};

static SPANISH: AtomicBool = AtomicBool::new(false);

/// Sets the language reported by the UI (a BCP 47 tag such as "es" or "en-US").
pub fn set_locale(tag: &str) {
    SPANISH.store(tag.to_ascii_lowercase().starts_with("es"), Ordering::Relaxed);
}

/// Picks the text for the active language.
pub fn tr(en: &str, es: &str) -> String {
    if SPANISH.load(Ordering::Relaxed) { es } else { en }.to_string()
}

/// Tells the backend which language the UI is showing.
#[tauri::command]
pub fn set_ui_locale(locale: String) {
    set_locale(&locale);
}
