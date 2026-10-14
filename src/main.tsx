import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { RouterProvider } from "react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./styles.css";
import { theme } from "./theme";

/** Points the hash router at the right screen based on the Tauri window label. */
function syncInitialRoute(): void {
  const label = getCurrentWindow().label;
  const projectId = label.startsWith("project-") ? label.slice("project-".length) : null;
  const target = projectId ? `#/project/${projectId}` : "#/";
  if (!window.location.hash.startsWith(target)) window.location.hash = target;
}

/** Mounts the React application. */
async function bootstrap(): Promise<void> {
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    const { installMocks } = await import("./dev/mockIpc");
    installMocks();
  }
  syncInitialRoute();
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
