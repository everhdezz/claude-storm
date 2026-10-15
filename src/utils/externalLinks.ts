import { openUrl } from "@tauri-apps/plugin-opener";

const EXTERNAL = /^(https?:|mailto:)/i;

/**
 * Opens every http(s)/mailto link in the user's default browser instead of navigating the app's
 * webview (chat Markdown, tool output, anything rendered as <a href>).
 */
export function openLinksInBrowser(): void {
  document.addEventListener(
    "click",
    (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]");
      const href = anchor?.getAttribute("href");
      if (!href || !EXTERNAL.test(href)) return;
      e.preventDefault();
      openUrl(href).catch(() => window.open(href, "_blank"));
    },
    true,
  );
}
