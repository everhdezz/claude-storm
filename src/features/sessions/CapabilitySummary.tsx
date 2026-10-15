import { Badge, Group, Popover, Stack, Text, UnstyledButton } from "@mantine/core";
import type { ChatItem } from "../../types";
import { capabilityUsage, KIND_META, type UsageEntry } from "./toolKinds";
import { t } from "../../i18n";

const ORDER: UsageEntry["kind"][] = ["skill", "mcp", "agent", "web"];

/** "2 skills · 5 MCP · 1 subagente" chips; the popover lists what was used and how often. */
export function CapabilitySummary({ items }: { items: ChatItem[] }) {
  const usage = capabilityUsage(items);
  if (usage.length === 0) return null;
  const byKind = ORDER.map((kind) => ({ kind, entries: usage.filter((u) => u.kind === kind) })).filter((g) => g.entries.length > 0);

  return (
    <Popover position="bottom-start" width={320} shadow="md" withinPortal>
      <Popover.Target>
        <UnstyledButton>
          <Group gap={4} wrap="nowrap">
            {byKind.map(({ kind, entries }) => {
              const total = entries.reduce((n, e) => n + e.count, 0);
              const meta = KIND_META[kind];
              return (
                <Badge key={kind} size="xs" variant="light" color={meta.color} style={{ cursor: "pointer" }}>
                  {total} {total === 1 ? meta.one : meta.many}
                </Badge>
              );
            })}
          </Group>
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm">
          <Text size="sm" fw={600}>
            {t("What Claude used in this session")}
          </Text>
          {byKind.map(({ kind, entries }) => (
            <div key={kind}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>
                {KIND_META[kind].tag}
              </Text>
              {entries.map((e) => (
                <Group key={e.label} justify="space-between" wrap="nowrap" gap="xs">
                  <Text size="xs" ff="monospace" truncate>
                    {e.label}
                  </Text>
                  <Text size="xs" c="dimmed">
                    ×{e.count}
                  </Text>
                </Group>
              ))}
            </div>
          ))}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
