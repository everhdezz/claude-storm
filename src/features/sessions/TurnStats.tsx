import { useEffect, useState } from "react";
import { Group, Loader, Text, Tooltip } from "@mantine/core";
import type { ChatItem } from "../../types";
import classes from "./sessions.module.css";
import { t, tn } from "../../i18n";

type Result = Extract<ChatItem, { kind: "result" }>;

/** Rough output tokens of text still streaming (Claude Code estimates the same way). */
const CHARS_PER_TOKEN = 4;

/** "1m 3s", "12s". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

/** "116", "1.2k", "3.4M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** Live line while Claude works: elapsed time and output tokens so far. */
export function WorkingLine({ since, tokens, streaming }: { since: string | null; tokens: number; streaming: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const output = tokens + Math.round(streaming.length / CHARS_PER_TOKEN);
  const parts = [since ? formatDuration(now - new Date(since).getTime()) : null, output > 0 ? `↓ ${formatTokens(output)} ${t("tokens")}` : null];
  return (
    <Group gap={8} className={`${classes.turnStats} ${classes.workingLine}`} pb="md">
      <Loader size="xs" type="dots" />
      <Text size="xs" c="dimmed">
        {t("Working…")}
        {parts.some(Boolean) && ` (${parts.filter(Boolean).join(" · ")})`}
      </Text>
    </Group>
  );
}

/** Summary under a finished turn: how long it took and the tokens it used. */
export function ResultStats({ item }: { item: Result }) {
  const parts = [
    item.durationMs != null ? t("Worked for {time}", { time: formatDuration(item.durationMs) }) : null,
    item.inputTokens != null ? `↑ ${formatTokens(item.inputTokens)}` : null,
    item.outputTokens != null ? `↓ ${formatTokens(item.outputTokens)} ${t("tokens")}` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  const details = [
    item.inputTokens != null ? t("{count} input tokens (cache included)", { count: item.inputTokens.toLocaleString() }) : null,
    item.outputTokens != null ? t("{count} output tokens", { count: item.outputTokens.toLocaleString() }) : null,
    item.turns != null ? tn(item.turns, "{count} turn", "{count} turns") : null,
    item.costUsd != null ? t("Equivalent API cost: ${cost}", { cost: item.costUsd.toFixed(4) }) : null,
  ].filter(Boolean);
  return (
    <Tooltip label={details.join(" · ")} disabled={details.length === 0} withinPortal>
      <Text size="xs" c="dimmed" className={classes.turnStats}>
        ✻ {parts.join(" · ")}
      </Text>
    </Tooltip>
  );
}
