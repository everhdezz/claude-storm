import { getLocale, t } from "../i18n";
let rtf: Intl.RelativeTimeFormat | null = null;

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

/** Formats an ISO date as a short relative phrase ("3 hours ago") in the active language. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return t("never");
  rtf ??= new Intl.RelativeTimeFormat(getLocale(), { numeric: "auto" });
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return t("just now");
}
