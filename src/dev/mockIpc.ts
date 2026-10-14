import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import type { ChatItem, ProcessInfo, Project, ProjectSummary, Session } from "../types";

/** Browser-only fixtures so the UI can be previewed outside Tauri during development. */
const projects: Project[] = [
  {
    id: "p1",
    name: "tickesoft",
    accountId: "a1",
    color: "#8a5cc7",
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
  { id: "p2", name: "payser-api", accountId: null, color: null, createdAt: "2026-10-01T10:00:00Z", lastOpenedAt: null, repos: [] },
];

/** Builds a fixture session. */
function fixtureSession(id: string, patch: Partial<Session>): Session {
  return {
    id,
    projectId: "p1",
    title: "Sesión",
    description: null,
    profileId: null,
    model: null,
    permissionMode: "acceptEdits",
    repoIds: ["r1", "r2"],
    mode: "direct",
    branch: null,
    status: "idle",
    claudeSessionId: id,
    hasConversation: true,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    summary: null,
    filesTouched: [],
    archived: false,
    lastError: null,
    baseBranches: {},
    ...patch,
  };
}

const sessions: Session[] = [
  fixtureSession("s1", { title: "Arreglar validación del checkout", status: "working", model: "opus", summary: "Revisando CheckoutForm.tsx…" }),
  fixtureSession("s2", {
    title: "Endpoint de reportes en la API",
    status: "done",
    mode: "isolated",
    branch: "devhub/endpoint-de-reportes-a1b2c3",
    repoIds: ["r1"],
    summary: "Agregué ReportController con tests.",
    filesTouched: ["a", "b", "c"],
    lastActivityAt: new Date(Date.now() - 40 * 60_000).toISOString(),
  }),
  fixtureSession("s3", { title: "¿Cómo funciona el login?", status: "waiting", model: "haiku", summary: "El login usa Sanctum con…" }),
];

const history: ChatItem[] = [
  { kind: "prompt", text: "La validación del checkout deja pasar emails sin dominio. Arréglalo y agrega un test.", model: "opus", at: new Date(Date.now() - 5 * 60_000).toISOString() },
  { kind: "text", text: "Voy a revisar el formulario del checkout y su esquema de validación." },
  { kind: "toolUse", id: "t1", name: "Grep", input: { pattern: "email", path: "src/checkout" } },
  { kind: "toolResult", toolUseId: "t1", content: "src/checkout/CheckoutForm.tsx:42:  email: z.string().min(3),", isError: false },
  { kind: "toolUse", id: "t2", name: "Edit", input: { file_path: "/private/var/www/html/tickesoft/tickesoft-web/src/checkout/CheckoutForm.tsx", old_string: "  email: z.string().min(3),", new_string: "  email: z.string().email(),\n  emailConfirm: z.string().email()," } },
  { kind: "toolResult", toolUseId: "t2", content: "ok", isError: false },
  { kind: "toolUse", id: "t3", name: "Bash", input: { command: "pnpm vitest run checkout" } },
  { kind: "toolResult", toolUseId: "t3", content: " ✓ checkout.test.ts (4 tests) 212ms\n Test Files  1 passed (1)", isError: false },
  { kind: "text", text: "Listo. Cambié la regla a `z.string().email()` y agregué un test:\n\n- rechaza `juan@`\n- acepta `juan@mail.com`" },
  { kind: "result", ok: true, text: "", costUsd: 0.0412, durationMs: 48200, turns: 6 },
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
        case "claude_usage":
        case "claude_usage_cached":
          return {
            profileKey: "default",
            fetchedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
            billing: "subscription",
            error: null,
            rawScreen: "",
            bars: [
              { label: "Current session", percent: 38, resetsText: "3:29pm (America/Chihuahua)", resetsAt: new Date(Date.now() + 75 * 60_000).toISOString() },
              { label: "Current week (all models)", percent: 47, resetsText: "Oct 17 at 3:59am (America/Chihuahua)", resetsAt: new Date(Date.now() + 63 * 3600_000).toISOString() },
              { label: "Current week (Fable)", percent: 0, resetsText: "Oct 17 at 4am (America/Chihuahua)", resetsAt: new Date(Date.now() + 63 * 3600_000).toISOString() },
            ],
          };
        case "get_settings":
          return {
            accounts: [
              { id: "a1", alias: "Trabajo", kind: "oauthToken", tokenHint: "…X9aQ", defaultModel: "opus", createdAt: "2026-10-14T10:00:00Z" },
              { id: "a2", alias: "Personal", kind: "systemLogin", tokenHint: null, defaultModel: null, createdAt: "2026-10-14T10:00:00Z" },
            ],
            models: [
              { value: "fable", label: "Fable" },
              { value: "opus", label: "Opus" },
              { value: "sonnet", label: "Sonnet" },
              { value: "haiku", label: "Haiku" },
            ],
            defaultModel: null,
            maxParallelSessions: 3,
          };
        case "list_sessions":
          return sessions;
        case "session_history":
          return history;
        case "terminal_open":
          return { id: `term-${Math.random()}`, projectId: a.projectId, cwd: a.cwd, title: String(a.cwd).split("/").pop() };
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
