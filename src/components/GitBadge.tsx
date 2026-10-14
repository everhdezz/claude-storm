import { Badge, Group, Text, Tooltip } from "@mantine/core";
import { IconGitBranch } from "@tabler/icons-react";
import type { GitStatus } from "../types";

/** Counts every file with pending changes. */
export function changedFiles(status: GitStatus): number {
  return Math.max(status.staged, status.modified) + status.untracked + status.conflicted;
}

/** Branch name with a change counter and ahead/behind hints. */
export function GitBadge({ status, compact = false }: { status: GitStatus | undefined; compact?: boolean }) {
  if (!status) return <Text size="xs" c="dimmed">git…</Text>;
  const changes = changedFiles(status);
  const detail = `${status.modified} modificados · ${status.staged} en stage · ${status.untracked} nuevos${
    status.conflicted ? ` · ${status.conflicted} en conflicto` : ""
  }`;
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
        <Tooltip label={detail}>
          <Badge size="xs" color={status.conflicted ? "red" : "yellow"} variant="light">
            {changes}
          </Badge>
        </Tooltip>
      )}
    </Group>
  );
}
