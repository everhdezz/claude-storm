import {
  ActionIcon,
  Badge,
  Code,
  Group,
  Loader,
  Popover,
  Progress,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { IconAlertTriangle, IconRefresh, IconSparkles } from "@tabler/icons-react";
import type { UsageBar } from "../../api/usage";
import { relativeTime } from "../../utils/time";
import { useProjectContext } from "../project/ProjectContext";
import { AccountLink } from "../settings/AccountLink";
import { APP_VERSION, channelLabel } from "../../version";
import { timeUntil, useClaudeUsage } from "./useClaudeUsage";
import classes from "../../components/ide/ide.module.css";
import { t } from "../../i18n";

interface StatusBarProps {
  projectId: string;
  right: React.ReactNode;
}

/** Fixed bottom bar: Claude plan usage on the left, window status on the right. */
export function StatusBar({ projectId, right }: StatusBarProps) {
  const { account } = useProjectContext();
  const usage = useClaudeUsage(projectId, account?.id ?? null);
  const { snapshot, loading, stale } = usage;
  const session = snapshot?.bars.find((b) => /session/i.test(b.label));
  const week =
    snapshot?.bars.find((b) => /week/i.test(b.label) && /all/i.test(b.label)) ??
    snapshot?.bars.find((b) => /week/i.test(b.label));

  return (
    <footer className={classes.statusBar}>
      <Group gap={10} wrap="nowrap">
        <AccountLink />
        {account && (
          <Popover position="top-start" width={420} shadow="md" withinPortal>
            <Popover.Target>
              <UnstyledButton>
                <Group gap={8} wrap="nowrap">
                  <IconSparkles size={13} color="var(--mantine-color-orange-4)" />
                  {!snapshot && loading && <Loader size={10} />}
                  {snapshot?.billing === "api" && <Text size="xs">{t("API key · billed per token")}</Text>}
                  {snapshot && snapshot.billing === "subscription" && snapshot.bars.length === 0 && (
                    <Text size="xs" c="yellow.5">
                      {t("no usage data")}
                    </Text>
                  )}
                  {session && <InlineBar name={t("Session")} bar={session} />}
                  {week && <InlineBar name={t("Week")} bar={week} />}
                  {stale && (
                    <Tooltip label={t("Data older than 60 minutes")}>
                      <IconAlertTriangle size={12} color="var(--mantine-color-yellow-5)" />
                    </Tooltip>
                  )}
                  {snapshot && loading && <Loader size={10} />}
                </Group>
              </UnstyledButton>
            </Popover.Target>
            <Popover.Dropdown>
              <UsageDetails usage={usage} />
            </Popover.Dropdown>
          </Popover>
        )}
      </Group>
      <Group gap="md" wrap="nowrap">
        {right}
        <Group gap={6} wrap="nowrap">
          <Text size="xs" c="dimmed">
            v{APP_VERSION}
          </Text>
          <Badge color="orange" variant="filled" size="xs" radius="sm">
            {channelLabel()}
          </Badge>
        </Group>
      </Group>
    </footer>
  );
}

/** Compact "Sesión 38% · 1h 20m" fragment. */
function InlineBar({ name, bar }: { name: string; bar: UsageBar }) {
  const left = timeUntil(bar.resetsAt);
  return (
    <Group gap={6} wrap="nowrap">
      <Text size="xs" c="dimmed">
        {name}
      </Text>
      <Progress value={bar.percent} w={46} size={5} color={barColor(bar.percent)} />
      <Text size="xs" c={bar.percent >= 85 ? "red.4" : "gray.3"}>
        {bar.percent}%
      </Text>
      {left && (
        <Text size="xs" c="dimmed">
          ↻ {left}
        </Text>
      )}
    </Group>
  );
}

/** Popover content with every bar, refresh control and raw fallback. */
function UsageDetails({ usage }: { usage: ReturnType<typeof useClaudeUsage> }) {
  const { snapshot, loading, stale, refresh } = usage;
  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text fw={600} size="sm">
          {t("Claude plan usage")}
        </Text>
        <Group gap={6}>
          {stale && (
            <Badge color="yellow" variant="light" size="sm">
              {t("outdated")}
            </Badge>
          )}
          <Tooltip label={t("Check now (/usage)")}>
            <ActionIcon variant="subtle" size="sm" loading={loading} onClick={() => refresh(true)} aria-label={t("Refresh usage")}>
              <IconRefresh size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      {snapshot?.bars.map((bar) => (
        <div key={bar.label}>
          <Group justify="space-between" mb={4}>
            <Text size="xs">{bar.label}</Text>
            <Text size="xs" fw={600}>
              {bar.percent}%
            </Text>
          </Group>
          <Progress value={bar.percent} size="sm" color={barColor(bar.percent)} />
          <Text size="xs" c="dimmed" mt={4}>
            {bar.resetsText ? t("Resets {when}", { when: bar.resetsText }) : t("No reset time")}
            {bar.resetsAt && ` · en ${timeUntil(bar.resetsAt)}`}
          </Text>
        </div>
      ))}
      {snapshot?.error && (
        <Text size="xs" c="yellow.5">
          {snapshot.error}
        </Text>
      )}
      {snapshot && snapshot.bars.length === 0 && snapshot.rawScreen && (
        <ScrollArea.Autosize mah={240}>
          <Code block fz={11}>
            {snapshot.rawScreen.trim()}
          </Code>
        </ScrollArea.Autosize>
      )}
      <Text size="xs" c="dimmed">
        {snapshot ? t("Updated {when}", { when: relativeTime(snapshot.fetchedAt) }) : t("Checking /usage…")} ·{" "}
        {t("refreshes every 10 min. The data comes from Claude Code's /usage screen; if its format changes, the raw text is shown.")}
      </Text>
    </Stack>
  );
}

/** Color ramp for usage percentages. */
function barColor(percent: number): string {
  if (percent >= 85) return "red";
  if (percent >= 60) return "yellow";
  return "teal";
}
