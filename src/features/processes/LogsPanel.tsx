import { useEffect, useRef, useState } from "react";
import { ActionIcon, Badge, Group, ScrollArea, SegmentedControl, Tabs, Text, Tooltip } from "@mantine/core";
import { IconChevronDown, IconChevronUp, IconClearAll, IconPlayerStop, IconX } from "@tabler/icons-react";
import { isActive, stopProcess } from "../../api/processes";
import { notifyError } from "../../hooks/notify";
import type { ProcessInfo, Repo } from "../../types";
import { ProcessStatusDot } from "./ProcessStatusDot";
import { useProcessLogs } from "./useProcessLogs";
import classes from "./processes.module.css";

interface LogsPanelProps {
  repos: Repo[];
  processes: Record<string, ProcessInfo>;
  activeRepoId: string | null;
  focusProcessId: string | null;
  expanded: boolean;
  onToggle: () => void;
  onSelectRepo: (repoId: string) => void;
  onForget: (processId: string) => void;
}

/** Collapsible bottom panel with one tab per repo that has run something. */
export function LogsPanel(props: LogsPanelProps) {
  const { repos, processes, activeRepoId, expanded, onToggle, onSelectRepo } = props;
  const list = Object.values(processes);
  const reposWithProcs = repos.filter((r) => list.some((p) => p.repoId === r.id));
  const running = list.filter(isActive).length;
  const currentRepo = reposWithProcs.find((r) => r.id === activeRepoId) ?? reposWithProcs[0];

  return (
    <div className={classes.panel} data-expanded={expanded || undefined}>
      <div className={classes.panelHeader}>
        <Group gap="xs" style={{ flex: 1, minWidth: 0 }} wrap="nowrap">
          <Text size="xs" fw={600} tt="uppercase" c="dimmed" onClick={onToggle} style={{ cursor: "pointer" }}>
            Procesos
          </Text>
          {running > 0 && (
            <Badge size="xs" color="teal" variant="light">
              {running} corriendo
            </Badge>
          )}
          {expanded && reposWithProcs.length > 0 && (
            <Tabs value={currentRepo?.id ?? null} onChange={(v) => v && onSelectRepo(v)} variant="pills" radius="sm">
              <Tabs.List>
                {reposWithProcs.map((r) => (
                  <Tabs.Tab key={r.id} value={r.id} size="xs" py={2} px={8}>
                    <Group gap={6} wrap="nowrap">
                      <ProcessStatusDot processes={list.filter((p) => p.repoId === r.id)} />
                      <Text size="xs">{r.name}</Text>
                    </Group>
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs>
          )}
        </Group>
        <ActionIcon variant="subtle" color="gray" size="sm" onClick={onToggle} aria-label="Mostrar u ocultar procesos">
          {expanded ? <IconChevronDown size={16} /> : <IconChevronUp size={16} />}
        </ActionIcon>
      </div>
      {expanded &&
        (currentRepo ? (
          <RepoLogs
            key={currentRepo.id}
            processes={list.filter((p) => p.repoId === currentRepo.id)}
            focusProcessId={props.focusProcessId}
            onForget={props.onForget}
          />
        ) : (
          <Text size="sm" c="dimmed" p="md">
            Aún no has ejecutado comandos en este proyecto.
          </Text>
        ))}
    </div>
  );
}

interface RepoLogsProps {
  processes: ProcessInfo[];
  focusProcessId: string | null;
  onForget: (processId: string) => void;
}

/** Log viewer for the processes of one repo, with a selector when there are several. */
function RepoLogs({ processes, focusProcessId, onForget }: RepoLogsProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const preferred = processes.find((p) => p.id === focusProcessId)?.id;

  useEffect(() => {
    if (preferred) setSelectedId(preferred);
  }, [preferred]);

  const current = processes.find((p) => p.id === selectedId) ?? processes[processes.length - 1];
  const { lines, clear } = useProcessLogs(current?.id ?? null, current?.startedAt);
  const viewport = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = viewport.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  if (!current) return null;
  return (
    <div className={classes.logsBody}>
      <Group justify="space-between" px="sm" py={4} wrap="nowrap">
        {processes.length > 1 ? (
          <SegmentedControl
            size="xs"
            value={current.id}
            onChange={setSelectedId}
            data={processes.map((p) => ({ value: p.id, label: p.label }))}
          />
        ) : (
          <Text size="xs" ff="monospace" c="dimmed" truncate>
            $ {current.command}
          </Text>
        )}
        <Group gap={4} wrap="nowrap">
          <Text size="xs" c="dimmed">
            {statusText(current)}
          </Text>
          {isActive(current) ? (
            <Tooltip label="Detener">
              <ActionIcon
                size="sm"
                variant="subtle"
                color="red"
                onClick={() => stopProcess(current.id).catch((e) => notifyError(e))}
                aria-label="Detener"
              >
                <IconPlayerStop size={14} />
              </ActionIcon>
            </Tooltip>
          ) : (
            <Tooltip label="Quitar de la lista">
              <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => onForget(current.id)} aria-label="Quitar">
                <IconX size={14} />
              </ActionIcon>
            </Tooltip>
          )}
          <Tooltip label="Limpiar logs">
            <ActionIcon size="sm" variant="subtle" color="gray" onClick={clear} aria-label="Limpiar logs">
              <IconClearAll size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <ScrollArea
        className={classes.logs}
        viewportRef={viewport}
        type="auto"
        onScrollPositionChange={({ y }) => {
          const el = viewport.current;
          if (el) stick.current = el.scrollHeight - el.clientHeight - y < 24;
        }}
      >
        <pre className={`${classes.pre} selectable`}>
          {lines.map((l) => (
            <div key={l.seq} className={classes[l.stream]}>
              {l.text || " "}
            </div>
          ))}
        </pre>
      </ScrollArea>
    </div>
  );
}

/** Human readable status line for a process. */
function statusText(p: ProcessInfo): string {
  switch (p.status) {
    case "running":
      return p.port ? (p.ready ? `corriendo · :${p.port}` : `arrancando · :${p.port}`) : `corriendo · pid ${p.pid}`;
    case "stopping":
      return "deteniendo…";
    case "stopped":
      return "detenido";
    case "exited":
      return "terminó (0)";
    case "failed":
      return `error (código ${p.exitCode ?? "?"})`;
  }
}
