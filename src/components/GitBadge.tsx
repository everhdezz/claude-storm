import { Badge, Group, Stack, Text, Tooltip } from "@mantine/core";
import { IconGitBranch } from "@tabler/icons-react";
import type { GitStatus } from "../types";
import { t } from "../i18n";

/** Counts every file with pending changes. */
export function changedFiles(status: GitStatus): number {
  return Math.max(status.staged, status.modified) + status.untracked + status.conflicted;
}

/** Branch name with +/- line counters (details on hover) and ahead/behind hints. */
export function GitBadge({ status, compact = false }: { status: GitStatus | undefined; compact?: boolean }) {
  if (!status) return <Text size="xs" c="dimmed">git…</Text>;
  const changes = changedFiles(status);
  const hasLines = status.insertions > 0 || status.deletions > 0;
  return (
    <Group gap={6} wrap="nowrap">
      <IconGitBranch size={14} stroke={1.6} />
      <Text size="xs" truncate maw={compact ? 110 : 220} ff="monospace">
        {status.branch ?? "detached"}
      </Text>
      {(status.ahead > 0 || status.behind > 0) && !compact && (
        <Text size="xs" c="dimmed">
          ↑{status.ahead} ↓{status.behind}
        </Text>
      )}
      {changes > 0 && (
        <Tooltip label={<ChangeDetails status={status} />} multiline withinPortal>
          {hasLines && !status.conflicted ? (
            <Group gap={4} wrap="nowrap" ff="monospace">
              {status.insertions > 0 && (
                <Text size="xs" c="teal.4" fw={600}>
                  +{status.insertions}
                </Text>
              )}
              {status.deletions > 0 && (
                <Text size="xs" c="red.4" fw={600}>
                  −{status.deletions}
                </Text>
              )}
            </Group>
          ) : (
            <Badge size="xs" color={status.conflicted ? "red" : "yellow"} variant="light">
              {changes}
            </Badge>
          )}
        </Tooltip>
      )}
    </Group>
  );
}

/** Tooltip body: line totals first, then file counts by state. */
function ChangeDetails({ status }: { status: GitStatus }) {
  const rows: [string, number, string?][] = [
    [t("{count} conflicted", { count: status.conflicted }), status.conflicted, "red.8"],
    [t("{count} modified", { count: status.modified }), status.modified],
    [t("{count} staged", { count: status.staged }), status.staged],
    [t("{count} new", { count: status.untracked }), status.untracked],
  ];
  return (
    <Stack gap={2}>
      <Group gap={8} ff="monospace">
        <Text size="xs" c="teal.8" fw={700}>
          +{status.insertions}
        </Text>
        <Text size="xs" c="red.8" fw={700}>
          −{status.deletions}
        </Text>
        <Text size="xs">{t("lines")}</Text>
      </Group>
      {rows
        .filter(([, n]) => n > 0)
        .map(([label, , color]) => (
          <Text key={label} size="xs" c={color}>
            {label}
          </Text>
        ))}
      {(status.ahead > 0 || status.behind > 0) && (
        <Text size="xs">
          {t("↑{ahead} to push · ↓{behind} to pull", { ahead: status.ahead, behind: status.behind })}
        </Text>
      )}
    </Stack>
  );
}
