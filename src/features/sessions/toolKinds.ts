import {
  IconFileText,
  IconPencil,
  IconPlugConnected,
  IconRobot,
  IconSearch,
  IconSparkles,
  IconTerminal2,
  IconTool,
  IconWorld,
  type Icon,
} from "@tabler/icons-react";
import type { ChatItem } from "../../types";
import { t } from "../../i18n";

type ToolUse = Extract<ChatItem, { kind: "toolUse" }>;

/** Claude capabilities worth calling out, beyond the built-in file/shell tools. */
export type ToolKind = "skill" | "mcp" | "agent" | "web" | "builtin";

export interface ToolInfo {
  kind: ToolKind;
  /** What was used: skill name, "Notion · search", subagent type, or the tool name. */
  label: string;
  icon: Icon;
}

export const KIND_META: Record<Exclude<ToolKind, "builtin">, { tag: string; one: string; many: string; color: string }> = {
  skill: { tag: "Skill", one: "skill", many: "skills", color: "grape" },
  mcp: { tag: "MCP", one: "MCP", many: "MCP", color: "cyan" },
  agent: { tag: t("Subagent"), one: t("subagent"), many: t("subagents"), color: "orange" },
  web: { tag: "Web", one: "web", many: "web", color: "blue" },
};

/** Turns "claude_ai_Google_Drive" into "Google Drive". */
function serverName(raw: string): string {
  return raw.replace(/^claude_ai_/, "").replace(/_/g, " ");
}

/** Classifies a tool call so skills, MCP servers and subagents stand out from file/shell tools. */
export function toolInfo(use: ToolUse): ToolInfo {
  const input = (use.input ?? {}) as Record<string, unknown>;
  const name = use.name;
  if (name === "Skill") {
    return { kind: "skill", label: String(input.skill ?? input.name ?? "skill"), icon: IconSparkles };
  }
  if (name.startsWith("mcp__")) {
    const [, server = "", ...rest] = name.split("__");
    return { kind: "mcp", label: `${serverName(server)} · ${rest.join("__") || "?"}`, icon: IconPlugConnected };
  }
  if (name === "Task" || name === "Agent") {
    return { kind: "agent", label: String(input.subagent_type ?? "general-purpose"), icon: IconRobot };
  }
  if (name === "WebFetch" || name === "WebSearch") {
    return { kind: "web", label: name === "WebSearch" ? t("Web search") : "WebFetch", icon: IconWorld };
  }
  return { kind: "builtin", label: name, icon: builtinIcon(name) };
}

/** Icon for a built-in tool. */
function builtinIcon(name: string): Icon {
  if (name === "Bash") return IconTerminal2;
  if (name === "Read") return IconFileText;
  if (name === "Edit" || name === "MultiEdit" || name === "Write") return IconPencil;
  if (name === "Grep" || name === "Glob") return IconSearch;
  return IconTool;
}

export interface UsageEntry {
  kind: Exclude<ToolKind, "builtin">;
  label: string;
  count: number;
}

/** Skills, MCP tools, subagents and web tools used in a conversation, most used first. */
export function capabilityUsage(items: ChatItem[]): UsageEntry[] {
  const map = new Map<string, UsageEntry>();
  for (const item of items) {
    if (item.kind !== "toolUse") continue;
    const info = toolInfo(item);
    if (info.kind === "builtin") continue;
    const key = `${info.kind}:${info.label}`;
    const entry = map.get(key) ?? { kind: info.kind, label: info.label, count: 0 };
    entry.count += 1;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}
