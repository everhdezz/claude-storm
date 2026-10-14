import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import type { ProcessInfo, Project, ProjectSummary } from "../types";

/** Browser-only fixtures so the UI can be previewed outside Tauri during development. */
const projects: Project[] = [
  {
    id: "p1",
    name: "tickesoft",
    createdAt: "2026-10-10T10:00:00Z",
    lastOpenedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    repos: [
      {
        id: "r1",
        name: "tickesoft-api",
        path: "/private/var/www/html/tickesoft/tickesoft-api",
        framework: "laravel",
        packageManager: "composer",
        port: 8000,
        commands: [
          { id: "c1", label: "serve", command: "php artisan serve --port=8000", longRunning: true },
          { id: "c2", label: "migrate", command: "php artisan migrate", longRunning: false },
          { id: "c3", label: "install", command: "composer install", longRunning: false },
        ],
      },
      {
        id: "r2",
        name: "tickesoft-web",
        path: "/private/var/www/html/tickesoft/tickesoft-web",
        framework: "vite",
        packageManager: "pnpm",
        port: 5173,
        commands: [
          { id: "c4", label: "dev", command: "pnpm dev", longRunning: true },
          { id: "c5", label: "build", command: "pnpm build", longRunning: false },
        ],
      },
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

/** Simulates a dev server that boots, logs a few lines and becomes ready. */
function simulateProcess(projectId: string, repoId: string, commandId: string): ProcessInfo {
  const repo = projects.flatMap((p) => p.repos).find((r) => r.id === repoId)!;
  const command = repo.commands.find((c) => c.id === commandId)!;
  const info: ProcessInfo = {
    id: `${repoId}:${commandId}`,
    projectId,
    repoId,
    commandId,
    label: command.label,
    command: command.command,
    longRunning: command.longRunning,
    status: "running",
    pid: 4242,
    port: command.longRunning ? repo.port : null,
    ready: false,
    exitCode: null,
    startedAt: new Date().toISOString(),
  };
  const lines = ["> starting", "  VITE v7.3.7  ready in 312 ms", `  ➜  Local:   http://localhost:${repo.port}/`, "warning: something on stderr"];
  lines.forEach((text, i) =>
    setTimeout(
      () => emit("process-log", { processId: info.id, repoId, line: { seq: i + 1, stream: i === 3 ? "stderr" : "stdout", text } }),
      300 * (i + 1),
    ),
  );
  setTimeout(() => emit("process-status", { ...info, ready: true }), 1500);
  if (!command.longRunning) setTimeout(() => emit("process-status", { ...info, status: "exited", exitCode: 0 }), 1800);
  setTimeout(() => emit("process-status", info), 10);
  return info;
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
        case "git_status":
          return { branch: "main", ahead: 1, behind: 0, staged: 0, modified: 3, untracked: 1, conflicted: 0 };
        case "start_command":
          return simulateProcess(a.projectId!, a.repoId!, a.commandId!);
        case "check_port":
          return false;
        case "list_processes":
        case "process_logs":
          return [];
        default:
          console.info("[mock] unhandled", cmd, args);
          return null;
      }
    },
    { shouldMockEvents: true },
  );
}
