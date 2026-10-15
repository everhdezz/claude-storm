import type { AccountKind, AppSettings, CatalogModel, ClaudeAccount, ProfileCheck } from "../types";
import type { UsageSnapshot } from "./usage";
import { call } from "./tauri";

export const SETTINGS_CHANGED = "settings-changed";

export const LOGIN_PROGRESS = "login-progress";

export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  profile: "Suscripción (perfil aislado)",
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

/** Enables or disables a model of Claude Code's catalog. */
export function setModelEnabled(id: string, enabled: boolean): Promise<void> {
  return call("set_model_enabled", { id, enabled });
}

/** Sets the global default model (null lets Claude Code decide). */
export function setDefaultModel(id: string | null): Promise<void> {
  return call("set_default_model", { id });
}

/** Re-reads the model list from Claude Code's /model picker. */
export function refreshModelCatalog(projectId: string | null): Promise<void> {
  return call("refresh_model_catalog", { projectId });
}

/** Models offered in pickers: the enabled ones, as Select options. */
export function modelOptions(catalog: CatalogModel[]): { value: string; label: string }[] {
  return catalog.filter((m) => m.enabled).map((m) => ({ value: m.id, label: m.label }));
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

/** Wizard step 1: registers a subscription profile (without login yet). */
export function createProfileAccount(alias: string, defaultModel: string | null): Promise<ClaudeAccount> {
  return call("create_profile_account", { input: { alias, defaultModel } });
}

/** Wizard step 2: creates the profile folder and copies shared config; returns what was copied. */
export function prepareProfile(accountId: string): Promise<string[]> {
  return call("prepare_profile", { accountId });
}

/** Wizard step 3: starts the hidden `claude auth login`; returns the login id. */
export function startProfileLogin(accountId: string): Promise<string> {
  return call("start_profile_login", { accountId });
}

/** Wizard step 4: sends the code shown by the browser. */
export function submitLoginCode(loginId: string, code: string): Promise<void> {
  return call("submit_login_code", { loginId, code });
}

/** Opens the authorization URL again. */
export function reopenLoginUrl(loginId: string): Promise<void> {
  return call("reopen_login_url", { loginId });
}

/** Cancels the login; `discard` deletes a profile created by this wizard. */
export function cancelProfileLogin(loginId: string | null, accountId: string, discard: boolean): Promise<void> {
  return call("cancel_profile_login", { loginId, accountId, discard });
}

/** Wizard step 5: asks Claude Code whether the profile is logged in and answers. */
export function verifyProfile(accountId: string): Promise<ProfileCheck> {
  return call("verify_profile", { accountId });
}

/** Checks whether a profile still has a valid login. */
export function profileStatus(accountId: string): Promise<boolean> {
  return call("profile_status", { accountId });
}

/** Re-copies shared config into a profile. */
export function resyncProfile(accountId: string): Promise<string[]> {
  return call("resync_profile", { accountId });
}

/** Plan usage of a specific account. */
export function accountUsage(accountId: string, force: boolean): Promise<UsageSnapshot> {
  return call("account_usage", { accountId, force });
}
