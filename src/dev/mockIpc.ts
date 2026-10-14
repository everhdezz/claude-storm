import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { Project, ProjectSummary } from "../types";

/** Browser-only fixtures so the UI can be previewed outside Tauri during development. */
const projects: Project[] = [
  {
    id: "p1",
    name: "tickesoft",
    createdAt: "2026-10-10T10:00:00Z",
    lastOpenedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    repos: [
      { id: "r1", name: "tickesoft-api", path: "/private/var/www/html/tickesoft/tickesoft-api", framework: "laravel", packageManager: null, port: 8000, commands: [] },
      { id: "r2", name: "tickesoft-web", path: "/private/var/www/html/tickesoft/tickesoft-web", framework: "vite", packageManager: "pnpm", port: 5173, commands: [] },
    ],
  },
  { id: "p2", name: "payser-api", createdAt: "2026-10-01T10:00:00Z", lastOpenedAt: null, repos: [] },
];

/** Converts a fixture project into the welcome list shape. */
function summarize(p: Project): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    repoCount: p.repos.length,
    rootHint: p.repos.length ? "/private/var/www/html/tickesoft" : null,
    createdAt: p.createdAt,
    lastOpenedAt: p.lastOpenedAt,
    isOpen: p.id === "p1",
  };
}

/** Installs Tauri IPC mocks; the window label comes from the ?window= query param. */
export function installMocks(): void {
  const label = new URLSearchParams(window.location.search).get("window") ?? "main";
  mockWindows(label);
  mockIPC(
    (cmd, args) => {
      const a = (args ?? {}) as Record<string, string>;
      switch (cmd) {
        case "list_projects":
          return projects.map(summarize);
        case "get_project":
          return projects.find((p) => p.id === a.id);
        default:
          console.info("[mock] unhandled", cmd, args);
          return null;
      }
    },
    { shouldMockEvents: true },
  );
}
