import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import type { AppSettings, ChatItem, ProcessInfo, Project, ProjectSummary, Session } from "../types";

const wikiFolders = new Set(["Guías", "Guías/Backend"]);
const wikiFiles = new Map<string, string>([
  ["Inicio.md", "# Bienvenido\n\nEsta es la wiki del proyecto **acme**.\n\n- [ ] Documentar la API\n- [x] Configurar el entorno\n\n> Escribe `/` para insertar bloques."],
  ["Guías/Setup local.md", "## Requisitos\n\n1. PHP 8.3\n2. Node 22\n\n```bash\ncomposer install\n```"],
  ["Guías/Backend/Colas.md", "Las colas usan **Redis**."],
]);

/** Deterministic fake uuid per mock page. */
function mockId(path: string): string {
  let h = 0;
  for (const c of path) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `${h.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
}

/** Builds the wiki tree from the flat mock folders and files, folders first. */
function wikiTree(parent = ""): unknown[] {
  const prefix = parent ? `${parent}/` : "";
  const direct = (p: string) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/");
  const folders = [...wikiFolders].filter(direct).sort().map((p) => ({ name: p.slice(prefix.length), path: p, kind: "folder", children: wikiTree(p) }));
  const docs = [...wikiFiles.keys()].filter(direct).sort().map((p) => ({ name: p.slice(prefix.length, -3), path: p, kind: "doc", id: mockId(p) }));
  return [...folders, ...docs];
}

/** Browser-only fixtures so the UI can be previewed outside Tauri during development. */
const projects: Project[] = [
  {
    id: "p1",
    name: "acme",
    accountId: "a1",
    color: "#8a5cc7",
    uiState: null,
    layout: [
      { kind: "group", id: "g1", name: "Backend", collapsed: false, repoIds: ["r1", "r3"] },
      { kind: "repo", repoId: "r2" },
      { kind: "repo", repoId: "r4" },
    ],
    createdAt: "2026-10-10T10:00:00Z",
    lastOpenedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    repos: [
      {
        id: "r1",
        name: "acme-api",
        path: "/Users/dev/code/acme/acme-api",
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
        id: "r3",
        name: "acme-services",
        path: "/Users/dev/code/acme/acme-services",
        framework: "laravel",
        packageManager: "composer",
        port: 8001,
        commands: [{ id: "c6", label: "serve", command: "php artisan serve --port=8001", longRunning: true }],
      },
      {
        id: "r4",
        name: "wallet-app",
        path: "/Users/dev/code/acme/wallet-app",
        framework: "expo",
        packageManager: "npm",
        port: 8081,
        commands: [{ id: "c7", label: "expo start", command: "npx expo start", longRunning: true }],
      },
      {
        id: "r2",
        name: "acme-web",
        path: "/Users/dev/code/acme/acme-web",
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
  { id: "p2", name: "billing-api", accountId: null, color: null, layout: [], uiState: null, createdAt: "2026-10-01T10:00:00Z", lastOpenedAt: null, repos: [] },
];

/** Builds a fixture session. */
function fixtureSession(id: string, patch: Partial<Session>): Session {
  return {
    id,
    projectId: "p1",
    title: "Session",
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
    lastModel: "claude-opus-5-5",
    pending: [],
    approvals: [],
    allowedTools: [],
    inputTokens: 0,
    outputTokens: 0,
    ...patch,
  };
}

const sessions: Session[] = [
  fixtureSession("s1", {
    title: "Fix checkout email validation",
    status: "working",
    model: "opus",
    summary: "Reviewing CheckoutForm.tsx…",
    approvals: [
      { id: "ap1", toolName: "WebFetch", input: { url: "https://api.example.com/swagger/v1/swagger.json", prompt: "List the routes" }, at: new Date().toISOString() },
      {
        id: "ap2",
        toolName: "AskUserQuestion",
        input: {
          questions: [
            {
              question: "Where should the 2FA secret live?",
              header: "2FA",
              multiSelect: false,
              options: [
                { label: "Users table", description: "A new encrypted column" },
                { label: "Separate table", description: "user_two_factor, with history" },
              ],
            },
          ],
        },
        at: new Date().toISOString(),
      },
    ],
    pending: [
      { id: "q1", text: "Also check the phone has 10 digits", prompt: "", model: null, attachments: [], at: new Date().toISOString() },
      { id: "q2", text: "and add that case to the test", prompt: "", model: null, attachments: ["screenshot.png"], at: new Date().toISOString() },
    ],
  }),
  fixtureSession("s2", {
    title: "Reports endpoint in the API",
    status: "done",
    mode: "isolated",
    branch: "reports-endpoint-a1b2c3",
    repoIds: ["r1"],
    summary: "Added ReportController with tests.",
    filesTouched: ["a", "b", "c"],
    lastActivityAt: new Date(Date.now() - 40 * 60_000).toISOString(),
  }),
  fixtureSession("s3", { title: "How does login work?", status: "waiting", model: "haiku", summary: "Login uses Sanctum with…" }),
];

const history: ChatItem[] = [
  { kind: "prompt", text: "Checkout validation lets emails without a domain through. Fix it and add a test.", model: "opus", at: new Date(Date.now() - 5 * 60_000).toISOString() },
  { kind: "prompt", text: 'the API returns this payload, does it include the author? "[{\\"orderId\\":\\"525c320c-e64a-4f42-93b6-76e029fa1556\\",\\"items\\":[{\\"sku\\":\\"BK-2291-BLUE-XL\\",\\"updatedAt\\":\\"2026-09-17T17:09:10.27\\",\\"updatedBy\\":\\"f05a2e79-ad3d-4bee-95a9-eefab5ca5808\\"}]}]"', model: "opus", at: new Date(Date.now() - 4 * 60_000).toISOString() },
  { kind: "text", text: "I'll look at the checkout form and its validation schema." },
  { kind: "toolUse", id: "k1", name: "Skill", input: { skill: "frontend-design" } },
  { kind: "toolResult", toolUseId: "k1", content: "Skill loaded", isError: false },
  { kind: "toolUse", id: "k2", name: "mcp__claude_ai_Atlassian_MCP__getJiraIssue", input: { issueIdOrKey: "TS-142" } },
  { kind: "toolResult", toolUseId: "k2", content: "{\"key\":\"TS-142\"}", isError: false },
  { kind: "toolUse", id: "k3", name: "Agent", input: { subagent_type: "Explore", description: "Find email validations" } },
  { kind: "toolResult", toolUseId: "k3", content: "Found 2 schemas", isError: false },
  { kind: "toolUse", id: "t1", name: "Grep", input: { pattern: "email", path: "src/checkout" } },
  { kind: "toolResult", toolUseId: "t1", content: "src/checkout/CheckoutForm.tsx:42:  email: z.string().min(3),", isError: false },
  { kind: "toolUse", id: "t2", name: "Edit", input: { file_path: "/Users/dev/code/acme/acme-web/src/checkout/CheckoutForm.tsx", old_string: "  email: z.string().min(3),", new_string: "  email: z.string().email(),\n  emailConfirm: z.string().email()," } },
  { kind: "toolResult", toolUseId: "t2", content: "ok", isError: false },
  { kind: "toolUse", id: "t3", name: "Bash", input: { command: "pnpm vitest run checkout" } },
  { kind: "toolResult", toolUseId: "t3", content: " ✓ checkout.test.ts (4 tests) 212ms\n Test Files  1 passed (1)", isError: false },
  { kind: "text", text: "Done. I changed the rule to `z.string().email()` and added a test:\n\n- rejects `jane@`\n- accepts `jane@mail.com`" },
  { kind: "result", ok: true, text: "", costUsd: 0.0412, durationMs: 48200, turns: 6, inputTokens: 184300, outputTokens: 2140 },
];

/** Converts a fixture project into the welcome list shape. */
function summarize(p: Project): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    repoCount: p.repos.length,
    rootHint: p.repos.length ? "/Users/dev/code/acme" : null,
    createdAt: p.createdAt,
    lastOpenedAt: p.lastOpenedAt,
    isOpen: p.id === "p1",
  };
}

/** Simulates a dev server that boots, logs a few lines and becomes ready. */
function simulateProcess(projectId: string, repoId: string, commandId: string, sessionId: string | null = null): ProcessInfo {
  const repo = projects.flatMap((p) => p.repos).find((r) => r.id === repoId)!;
  const command = repo.commands.find((c) => c.id === commandId)!;
  const info: ProcessInfo = {
    id: `${repoId}:${commandId}`,
    projectId,
    repoId,
    cwd: repo.path,
    sessionId,
    startedBy: null,
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
        case "get_project": {
          const found = projects.find((p) => p.id === a.id);
          const saved = sessionStorage.getItem(`mock-ui-${a.id}`);
          return found && saved ? { ...found, uiState: JSON.parse(saved) } : found;
        }
        case "git_status":
          return { branch: "main", ahead: 1, behind: 0, staged: 0, modified: 3, untracked: 1, conflicted: 0, insertions: 128, deletions: 41 };
        case "git_branches":
          return {
            current: "main",
            recent: ["feat/login"],
            branches: [
              { name: "main", remote: false, current: true, upstream: "origin/main", ahead: 1, behind: 0, worktree: null, committedAt: 1760400000 },
              { name: "feat/login", remote: false, current: false, upstream: "origin/feat/login", ahead: 0, behind: 2, worktree: null, committedAt: 1760300000 },
              { name: "fix-header-a1b2c3", remote: false, current: false, upstream: null, ahead: 0, behind: 0, worktree: "/tmp/wt/web", committedAt: 1760350000 },
              { name: "origin/main", remote: true, current: false, upstream: null, ahead: 0, behind: 0, worktree: null, committedAt: 1760400000 },
              { name: "origin/feat/login", remote: true, current: false, upstream: null, ahead: 0, behind: 0, worktree: null, committedAt: 1760300000 },
            ],
          };
        case "start_command":
          return simulateProcess(a.projectId!, a.repoId!, a.commandId!, a.sessionId ?? null);
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
        case "set_language":
          sessionStorage.setItem("mock-language", String(a.language));
          emit("settings-changed", { language: a.language });
          return null;
        case "get_settings":
          return {
            accounts: [
              { id: "a1", alias: "Work", kind: "oauthToken", tokenHint: "…X9aQ", defaultModel: "claude-opus-5-5", createdAt: "2026-10-14T10:00:00Z" },
              { id: "a2", alias: "Personal", kind: "systemLogin", tokenHint: null, defaultModel: null, createdAt: "2026-10-14T10:00:00Z" },
            ],
            catalog: [
              { id: "claude-opus-5-5", label: "Opus 5.5", description: "For complex work and everyday tasks", enabled: true },
              { id: "claude-fable-5-1", label: "Fable 5.1", description: "For your toughest challenges", enabled: true },
              { id: "claude-sonnet-5-5", label: "Sonnet 5.5", description: "Most efficient for simpler tasks", enabled: true },
              { id: "claude-haiku-5-5", label: "Haiku 5.5", description: "Fastest for quick answers", enabled: true },
              { id: "claude-opus-4-8", label: "Opus 4.8", description: "Best for everyday, complex tasks", enabled: false },
            ],
            catalogUpdatedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
            defaultModel: null,
            maxParallelSessions: 3,
            editor: "WebStorm",
            notifications: "background",
            language: (sessionStorage.getItem("mock-language") ?? "auto") as AppSettings["language"],
          };
        case "save_project_ui_state": {
          const target = projects.find((p) => p.id === a.id);
          if (target) target.uiState = (args as { state: unknown }).state;
          sessionStorage.setItem(`mock-ui-${a.id}`, JSON.stringify((args as { state: unknown }).state));
          return null;
        }
        case "save_repo_layout": {
          const project = projects.find((p) => p.id === a.projectId);
          if (project) project.layout = (args as { layout: Project["layout"] }).layout;
          emit("projects-changed", null);
          return null;
        }
        case "list_sessions":
          return sessions;
        case "session_history":
          return history;
        case "terminal_open":
          return { id: `term-${Math.random()}`, projectId: a.projectId, cwd: a.cwd, title: String(a.cwd).split("/").pop() };
        case "session_remove_pending":
          return sessions.flatMap((s) => s.pending).find((m) => m.id === a.messageId) ?? null;
        case "save_pasted_file":
          return `/tmp/claude-storm/pasted/captura-${Date.now()}.png`;
        case "list_processes":
        case "process_logs":
          return [];
        case "wiki_tree":
          return wikiTree();
        case "wiki_root":
          return "/tmp/claude-storm/wiki/p1";
        case "wiki_read":
          return wikiFiles.get(String(a.path)) ?? "";
        case "wiki_write":
          wikiFiles.set(String(a.path), String(a.content));
          return null;
        case "wiki_create": {
          const base = `${a.parent ? `${a.parent}/` : ""}${a.name}`;
          let path = a.kind === "doc" ? `${base}.md` : base;
          for (let n = 2; wikiFiles.has(path) || wikiFolders.has(path); n++) path = a.kind === "doc" ? `${base} ${n}.md` : `${base} ${n}`;
          if (a.kind === "doc") wikiFiles.set(path, "");
          else wikiFolders.add(path);
          return path;
        }
        case "wiki_rename":
        case "wiki_move": {
          const from = String(a.path);
          const isDoc = wikiFiles.has(from);
          const name = cmd === "wiki_rename" ? String(a.name) : from.split("/").pop()!.replace(/\.md$/, "");
          const parent = cmd === "wiki_rename" ? from.split("/").slice(0, -1).join("/") : String(a.parent);
          const to = `${parent ? `${parent}/` : ""}${name}${isDoc ? ".md" : ""}`;
          const move = (p: string) => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p);
          for (const [k, v] of [...wikiFiles]) if (move(k) !== k) (wikiFiles.delete(k), wikiFiles.set(move(k), v));
          for (const k of [...wikiFolders]) if (move(k) !== k) (wikiFolders.delete(k), wikiFolders.add(move(k)));
          return to;
        }
        case "wiki_delete":
          for (const key of [...wikiFiles.keys()]) if (key === a.path || key.startsWith(`${a.path}/`)) wikiFiles.delete(key);
          for (const key of [...wikiFolders]) if (key === a.path || key.startsWith(`${a.path}/`)) wikiFolders.delete(key);
          return null;
        default:
          console.info("[mock] unhandled", cmd, args);
          return null;
      }
    },
    { shouldMockEvents: true },
  );
}
