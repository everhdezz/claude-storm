import type { AccountKind, AppSettings, ClaudeAccount, ModelOption } from "../types";
import { call } from "./tauri";

export const SETTINGS_CHANGED = "settings-changed";

export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  oauthToken: "Token de suscripción",
  apiKey: "API key",
  systemLogin: "Login de este equipo",
};

/** Reads global settings (accounts without secrets, models, limits). */
export function getSettings(): Promise<AppSettings> {
  return call("get_settings");
}

/** Adds an account; the secret goes to the OS keychain. */
export function createAccount(input: {
  alias: string;
  kind: AccountKind | null;
  secret: string | null;
  defaultModel: string | null;
}): Promise<ClaudeAccount> {
  return call("create_account", { input });
}

/** Edits an account; an empty secret keeps the stored one. */
export function updateAccount(id: string, patch: { alias?: string; secret?: string; defaultModel?: string }): Promise<void> {
  return call("update_account", { id, patch });
}

/** Deletes an account and its secret. */
export function deleteAccount(id: string): Promise<void> {
  return call("delete_account", { id });
}

/** Saves the list of models offered in pickers. */
export function saveModels(models: ModelOption[], defaultModel: string | null): Promise<void> {
  return call("save_models", { models, defaultModel });
}

/** Sets how many sessions may work at once. */
export function setMaxParallelSessions(value: number): Promise<void> {
  return call("set_max_parallel_sessions", { value });
}

/** Selects the Claude account of a project. */
export function setProjectAccount(projectId: string, accountId: string | null): Promise<void> {
  return call("set_project_account", { projectId, accountId });
}

/** Sets the header color of a project. */
export function setProjectColor(projectId: string, color: string | null): Promise<void> {
  return call("set_project_color", { projectId, color });
}

/** Guesses the account type from a pasted secret. */
export function detectKind(secret: string): AccountKind | null {
  const s = secret.trim();
  if (s.startsWith("sk-ant-oat")) return "oauthToken";
  if (s.startsWith("sk-ant-api")) return "apiKey";
  return null;
}
