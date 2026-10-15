/** Shared domain types mirroring the Rust models (camelCase over the wire). */

export type Framework = "next" | "vite" | "react" | "expo" | "laravel" | "node" | "generic";

export interface RepoCommand {
  id: string;
  label: string;
  command: string;
  longRunning: boolean;
}

export interface Repo {
  id: string;
  name: string;
  path: string;
  framework: Framework;
  packageManager: string | null;
  port: number | null;
  commands: RepoCommand[];
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  lastOpenedAt: string | null;
  repos: Repo[];
  accountId: string | null;
  color: string | null;
  layout: LayoutItem[];
  uiState: unknown;
}

export type LayoutItem =
  | { kind: "repo"; repoId: string }
  | { kind: "group"; id: string; name: string; collapsed: boolean; repoIds: string[] };

export interface ProjectSummary {
  id: string;
  name: string;
  repoCount: number;
  rootHint: string | null;
  createdAt: string;
  lastOpenedAt: string | null;
  isOpen: boolean;
}

export interface Detection {
  framework: Framework;
  packageManager: string | null;
  port: number | null;
  commands: RepoCommand[];
}

export interface RepoCandidate {
  name: string;
  path: string;
  alreadyAdded: boolean;
  detection: Detection;
}

export interface RepoPatch {
  name: string;
  port: number | null;
  commands: RepoCommand[];
}

export interface GitStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  conflicted: number;
}

export type ProcessStatus = "running" | "stopping" | "stopped" | "exited" | "failed";

export interface ProcessInfo {
  id: string;
  projectId: string;
  repoId: string;
  commandId: string;
  label: string;
  command: string;
  longRunning: boolean;
  status: ProcessStatus;
  pid: number | null;
  port: number | null;
  ready: boolean;
  exitCode: number | null;
  startedAt: string;
}

export interface LogLine {
  seq: number;
  stream: "stdout" | "stderr" | "system";
  text: string;
}

export interface LogEvent {
  processId: string;
  repoId: string;
  line: LogLine;
}

export type SessionStatus = "idle" | "queued" | "working" | "waiting" | "done" | "error" | "interrupted";
export type SessionMode = "direct" | "isolated";

export interface Session {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  profileId: string | null;
  model: string | null;
  permissionMode: string;
  repoIds: string[];
  mode: SessionMode;
  branch: string | null;
  status: SessionStatus;
  claudeSessionId: string;
  hasConversation: boolean;
  createdAt: string;
  lastActivityAt: string;
  summary: string | null;
  filesTouched: string[];
  archived: boolean;
  lastError: string | null;
  baseBranches: Record<string, string>;
  lastModel: string | null;
}

export type ChatItem =
  | { kind: "prompt"; text: string; model: string | null; account?: string | null; attachments?: string[]; at: string }
  | { kind: "text"; text: string }
  | { kind: "toolUse"; id: string; name: string; input: Record<string, unknown> }
  | { kind: "toolResult"; toolUseId: string; content: string; isError: boolean }
  | { kind: "result"; ok: boolean; text: string; costUsd: number | null; durationMs: number | null; turns: number | null }
  | { kind: "notice"; level: "info" | "warn" | "error"; text: string };

export interface NewSessionInput {
  title: string;
  description?: string | null;
  repoIds: string[];
  model?: string | null;
  permissionMode?: string;
  mode: SessionMode;
}

export interface RepoDiff {
  repoId: string;
  repoName: string;
  base: string;
  diff: string;
}

export type WorktreeCleanup = "keep" | "removeWorktree" | "removeWorktreeAndBranch";

export type AccountKind = "profile" | "apiKey" | "systemLogin";

export interface ClaudeAccount {
  id: string;
  alias: string;
  kind: AccountKind;
  tokenHint: string | null;
  defaultModel: string | null;
  createdAt: string;
  loginEmail: string | null;
  needsLogin: boolean;
}

export interface LoginProgress {
  loginId: string;
  accountId: string;
  stage: "browser" | "codeInvalid" | "authorized" | "failed" | "timeout";
  url: string | null;
  manualUrl: string | null;
  message: string | null;
  details: string | null;
}

export interface ProfileCheck {
  loggedIn: boolean;
  authMethod: string | null;
  email: string | null;
  subscription: string | null;
  replyOk: boolean | null;
  details: string;
}

export interface CatalogModel {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
}

export interface AppSettings {
  accounts: ClaudeAccount[];
  catalog: CatalogModel[];
  catalogUpdatedAt: string | null;
  defaultModel: string | null;
  maxParallelSessions: number;
}
