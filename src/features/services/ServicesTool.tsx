import { ActionIcon, Badge, Group, Menu, ScrollArea, Text, Tooltip, UnstyledButton } from "@mantine/core";
import {
  IconCheck,
  IconChevronDown,
  IconClearAll,
  IconGitBranch,
  IconExternalLink,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconSparkles,
} from "@tabler/icons-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isActive, processKey, stopProcess } from "../../api/processes";
import { FrameworkIcon } from "../../components/FrameworkIcon";
import { notifyError } from "../../hooks/notify";
import type { ProcessInfo, Repo, RepoCommand } from "../../types";
import { LogView } from "../processes/LogView";
import { ProcessStatusDot } from "../processes/ProcessStatusDot";
import { useProcessLogs } from "../processes/useProcessLogs";
import { useRunCommand } from "../processes/useRunCommand";
import { useProjectContext } from "../project/ProjectContext";
import classes from "./services.module.css";
import { t } from "../../i18n";

interface Selection {
  repo: Repo;
  command: RepoCommand;
  process: ProcessInfo | undefined;
}

/** WebStorm-like Services tool window: repo/command tree on the left, output on the right. */
export function ServicesTool() {
  const { project, processes, selectedService, selectService } = useProjectContext();
  const run = useRunCommand();

  const entries: Selection[] = project.repos.flatMap((repo) =>
    repo.commands.map((command) => ({ repo, command, process: processes[processKey(repo.id, command.id)] })),
  );
  const current = entries.find((e) => processKey(e.repo.id, e.command.id) === selectedService) ?? entries.find((e) => e.process);

  if (entries.length === 0) {
    return (
      <Text size="sm" c="dimmed" p="md">
        {t("No repo has commands configured.")}
      </Text>
    );
  }

  return (
    <div className={classes.split}>
      <ScrollArea className={classes.tree} type="auto">
        {project.repos
          .filter((r) => r.commands.length > 0)
          .map((repo) => {
            const repoProcs = repo.commands.map((c) => processes[processKey(repo.id, c.id)]).filter((p): p is ProcessInfo => !!p);
            return (
              <div key={repo.id}>
                <div className={classes.group}>
                  <FrameworkIcon framework={repo.framework} size={18} />
                  <Text size="xs" fw={600} truncate>
                    {repo.name}
                  </Text>
                  <ProcessStatusDot processes={repoProcs} />
                </div>
                {repo.commands.map((command) => {
                  const key = processKey(repo.id, command.id);
                  const proc = processes[key];
                  return (
                    <div
                      key={command.id}
                      className={classes.item}
                      data-selected={current && processKey(current.repo.id, current.command.id) === key ? true : undefined}
                      onClick={() => selectService(key)}
                      onDoubleClick={() => !isActive(proc) && run(repo, command)}
                    >
                      <ProcessStatusDot processes={proc ? [proc] : []} keepSpace />
                      <Text size="xs" truncate style={{ flex: 1 }}>
                        {command.label}
                      </Text>
                      {proc?.port && proc.status === "running" && (
                        <Text size="xs" c={proc.ready ? "teal" : "yellow"}>
                          :{proc.port}
                        </Text>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
      </ScrollArea>
      {current && <ServiceOutput key={processKey(current.repo.id, current.command.id)} selection={current} onRun={run} />}
    </div>
  );
}

/** "Correr en: …" picker in the Services header: the main checkout or an isolated session's worktree. */
export function RunTargetPicker() {
  const { sessions, runTarget, setRunTarget } = useProjectContext();
  const candidates = sessions.filter((s) => s.mode === "isolated" && !s.archived);
  const target = candidates.find((s) => s.id === runTarget);
  if (candidates.length === 0) return null;

  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <UnstyledButton>
          <Group gap={4} wrap="nowrap">
            <Text size="xs" c="dimmed">
              {t("Run in")}
            </Text>
            <Text size="xs" c={target ? "teal.4" : undefined} fw={500} truncate maw={180}>
              {target ? target.title : t("main checkout")}
            </Text>
            <IconChevronDown size={12} />
          </Group>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={runTarget ? <span style={{ width: 14 }} /> : <IconCheck size={14} />} onClick={() => setRunTarget(null)}>
          {t("Main checkout")}
        </Menu.Item>
        <Menu.Label>{t("A session's worktree")}</Menu.Label>
        {candidates.map((s) => (
          <Menu.Item
            key={s.id}
            leftSection={s.id === runTarget ? <IconCheck size={14} /> : <span style={{ width: 14 }} />}
            rightSection={
              <Group gap={4} wrap="nowrap">
                <IconGitBranch size={12} />
                <Text size="xs" c="dimmed" ff="monospace" truncate maw={160}>
                  {s.branch}
                </Text>
              </Group>
            }
            onClick={() => setRunTarget(s.id)}
          >
            {s.title}
          </Menu.Item>
        ))}
        <Text size="xs" c="dimmed" px="sm" py={6} maw={320}>
          {t("Applies to what you start from now on. Repos the session does not include keep running in the main checkout.")}
        </Text>
      </Menu.Dropdown>
    </Menu>
  );
}

/** Toolbar and log output of the selected service. */
function ServiceOutput({ selection, onRun }: { selection: Selection; onRun: (repo: Repo, command: RepoCommand) => void }) {
  const { sessions } = useProjectContext();
  const { repo, command, process } = selection;
  const worktreeOf = process?.sessionId ? sessions.find((s) => s.id === process.sessionId) : undefined;
  const starter = process?.startedBy ? sessions.find((s) => s.id === process.startedBy) : undefined;
  const { lines, clear } = useProcessLogs(process?.id ?? null, process?.startedAt);
  const active = isActive(process);

  function stop() {
    if (process) stopProcess(process.id).catch((e) => notifyError(e));
  }

  async function restart() {
    if (process && active) await stopProcess(process.id).catch((e) => notifyError(e));
    onRun(repo, command);
  }

  return (
    <div className={classes.output}>
      <Group gap={2} px={6} py={4} wrap="nowrap" className={classes.toolbar}>
        <Tooltip label={active ? t("Restart") : t("Run")}>
          <ActionIcon variant="subtle" color="teal" size="sm" onClick={restart} aria-label={t("Run")}>
            {active ? <IconRefresh size={15} /> : <IconPlayerPlay size={15} />}
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t("Stop")}>
          <ActionIcon variant="subtle" color="red" size="sm" disabled={!active} onClick={stop} aria-label={t("Stop")}>
            <IconPlayerStop size={15} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t("Clear output")}>
          <ActionIcon variant="subtle" color="gray" size="sm" onClick={clear} aria-label={t("Clear output")}>
            <IconClearAll size={15} />
          </ActionIcon>
        </Tooltip>
        {process?.ready && process.port && (
          <Tooltip label={t("Open {url}", { url: `http://localhost:${process.port}` })}>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              onClick={() => openUrl(`http://localhost:${process.port}`)}
              aria-label={t("Open in browser")}
            >
              <IconExternalLink size={15} />
            </ActionIcon>
          </Tooltip>
        )}
        <Text size="xs" c="dimmed" ff="monospace" truncate ml={6} style={{ flex: 1 }}>
          {command.command}
        </Text>
        {process?.startedBy && (
          <Tooltip label={starter ? t("Started by Claude in “{session}”", { session: starter.title }) : t("Started by Claude")}>
            <Badge size="xs" variant="light" color="orange" leftSection={<IconSparkles size={10} />}>
              Claude
            </Badge>
          </Tooltip>
        )}
        {process?.sessionId && (
          <Tooltip label={process.cwd}>
            <Badge size="xs" variant="light" color="teal" leftSection={<IconGitBranch size={10} />}>
              {worktreeOf?.branch ?? "worktree"}
            </Badge>
          </Tooltip>
        )}
        <Text size="xs" c="dimmed">
          {process ? statusText(process) : t("not started")}
        </Text>
      </Group>
      {process ? (
        <LogView lines={lines} />
      ) : (
        <Text size="sm" c="dimmed" p="md">
          {t("Double-click or ▶ to run.")}
        </Text>
      )}
    </div>
  );
}

/** Human readable status of a process. */
function statusText(p: ProcessInfo): string {
  switch (p.status) {
    case "running":
      return p.port ? (p.ready ? t("running on :{port}", { port: p.port }) : t("starting (:{port})", { port: p.port })) : t("running · pid {pid}", { pid: p.pid ?? "?" });
    case "stopping":
      return t("stopping…");
    case "stopped":
      return t("stopped");
    case "exited":
      return t("finished (0)");
    case "failed":
      return t("error (code {code})", { code: p.exitCode ?? "?" });
  }
}
