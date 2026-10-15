import es from "./locales/es";

/** Languages with a catalog. English is the source language: its keys are the English text itself. */
export const LOCALES = {
  en: "English",
  es: "Español",
} as const;

export type Locale = keyof typeof LOCALES;
/** What the user picked in Settings; "auto" follows the operating system. */
export type LanguagePref = "auto" | Locale;

type Catalog = Record<string, string>;
const CATALOGS: Record<Locale, Catalog> = { en: {}, es };

let current: Locale = "en";

/** First supported language among the system's preferred ones, or English. */
export function detectLocale(pref: LanguagePref = "auto"): Locale {
  if (pref !== "auto") return pref;
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of preferred) {
    const base = tag?.toLowerCase().split("-")[0];
    if (base && base in CATALOGS) return base as Locale;
  }
  return "en";
}

/** Activates a language for this window (call before the first render). */
export function setLocale(locale: Locale): void {
  current = locale;
  document.documentElement.lang = locale;
}

export function getLocale(): Locale {
  return current;
}

/**
 * Translates an English source string, filling `{name}` placeholders.
 * Missing translations fall back to the English text.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const template = CATALOGS[current][key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** Picks the singular or plural source string by `count` (also available as `{count}`). */
export function tn(count: number, one: string, other: string, vars?: Record<string, string | number>): string {
  return t(count === 1 ? one : other, { count, ...vars });
}
