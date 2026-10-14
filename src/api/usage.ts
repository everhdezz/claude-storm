import { call } from "./tauri";

export const USAGE_UPDATED = "usage-updated";

export interface UsageBar {
  label: string;
  percent: number;
  resetsText: string | null;
  resetsAt: string | null;
}

export interface UsageSnapshot {
  profileKey: string;
  fetchedAt: string;
  bars: UsageBar[];
  rawScreen: string;
  error: string | null;
  billing: "subscription" | "api";
}

/** Reads plan usage through Claude Code's `/usage`, served from cache when fresh. */
export function claudeUsage(projectId: string, force: boolean): Promise<UsageSnapshot | null> {
  return call("claude_usage", { projectId, force });
}

/** Returns the last cached usage without querying Claude Code. */
export function claudeUsageCached(projectId: string): Promise<UsageSnapshot | null> {
  return call("claude_usage_cached", { projectId });
}
