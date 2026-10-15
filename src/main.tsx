import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { RouterProvider } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./styles.css";
import { theme } from "./theme";
import { openLinksInBrowser } from "./utils/externalLinks";
import { detectLocale, setLocale, t, type LanguagePref } from "./i18n";

/** Points the hash router at the right screen based on the Tauri window label. */
function syncInitialRoute(): void {
  const label = getCurrentWindow().label;
  const projectId = label.startsWith("project-") ? label.slice("project-".length) : null;
  const target = projectId ? `#/project/${projectId}` : "#/";
  if (!window.location.hash.startsWith(target)) window.location.hash = target;
}

/**
 * Activates the UI language before anything renders: the one picked in Settings, else the
 * system's, else English. Changing it later reloads every window.
 */
async function applyLanguage(): Promise<void> {
  const pref = await invoke<{ language?: LanguagePref }>("get_settings")
    .then((s) => s?.language ?? "auto")
    .catch(() => "auto" as const);
  const locale = detectLocale(pref);
  setLocale(locale);
  invoke("set_ui_locale", { locale }).catch(() => undefined);
  const win = getCurrentWindow();
  if (!win.label.startsWith("project-")) win.setTitle(t("Welcome to ClaudeStorm")).catch(() => undefined);
  listen<{ language?: LanguagePref }>("settings-changed", (e) => {
    if ((e.payload?.language ?? "auto") !== pref) window.location.reload();
  }).catch(() => undefined);
}

/** Mounts the React application. */
async function bootstrap(): Promise<void> {
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    const { installMocks } = await import("./dev/mockIpc");
    installMocks();
  }
  syncInitialRoute();
  await applyLanguage();
  openLinksInBrowser();
  const { router } = await import("./router");
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <MantineProvider theme={theme} defaultColorScheme="dark">
        <ModalsProvider>
          <Notifications position="bottom-right" />
          <RouterProvider router={router} />
        </ModalsProvider>
      </MantineProvider>
    </React.StrictMode>,
  );
}

bootstrap();
