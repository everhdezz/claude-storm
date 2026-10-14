import { useState } from "react";
import { ActionIcon, Menu, ScrollArea, Text, Tooltip } from "@mantine/core";
import {
  IconChevronDown,
  IconChevronRight,
  IconDots,
  IconFolderPlus,
  IconFolderSearch,
  IconPlayerPlay,
  IconPlayerStop,
  IconTerminal2,
} from "@tabler/icons-react";
import { isActive, processKey, stopProcess } from "../../api/processes";
import { FrameworkIcon } from "../../components/FrameworkIcon";
import { GitBadge } from "../../components/GitBadge";
import { Island } from "../../components/ide/Island";
import { notifyError } from "../../hooks/notify";
import type { Repo, RepoCommand } from "../../types";
import { ProcessStatusDot } from "../processes/ProcessStatusDot";
import { useRunCommand } from "../processes/useRunCommand";
import { useProjectContext } from "../project/ProjectContext";
import { ScanReposModal } from "../repos/ScanReposModal";
import { useAddFolder } from "../repos/useAddRepos";
import classes from "./projects-tool.module.css";

/** Left tool window listing the project's repos with run buttons for their commands. */
export function ProjectsTool({ style }: { style?: React.CSSProperties }) {
  const { project } = useProjectContext();
  const addFolder = useAddFolder(project.id);
  const [scanOpen, setScanOpen] = useState(false);

  return (
    <Island
      title={project.name}
      style={style}
      actions={
        <>
          <Tooltip label="Agregar carpeta">
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={addFolder} aria-label="Agregar carpeta">
              <IconFolderPlus size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Escanear carpeta">
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => setScanOpen(true)} aria-label="Escanear carpeta">
              <IconFolderSearch size={15} />
            </ActionIcon>
          </Tooltip>
        </>
      }
    >
      <ScrollArea style={{ flex: 1 }} type="auto">
        {project.repos.length === 0 ? (
          <Text size="sm" c="dimmed" px="md" py="xs">
            Sin repos. Agrega una carpeta o escanea una carpeta padre.
          </Text>
        ) : (
          project.repos.map((repo) => <RepoNode key={repo.id} repo={repo} />)
        )}
      </ScrollArea>
      <ScanReposModal projectId={project.id} opened={scanOpen} onClose={() => setScanOpen(false)} />
    </Island>
  );
}

/** Expandable repo row; children are its runnable commands. */
function RepoNode({ repo }: { repo: Repo }) {
  const { gitStatuses, processes, openTerminalAt } = useProjectContext();
  const run = useRunCommand();
  const [open, setOpen] = useState(true);
  const procs = repo.commands.map((c) => processes[processKey(repo.id, c.id)]).filter((p) => !!p);
  const primary = repo.commands.find((c) => c.longRunning) ?? repo.commands[0];

  return (
    <div>
      <div className={classes.row} onClick={() => setOpen((v) => !v)}>
        {open ? <IconChevronDown size={14} className={classes.chevron} /> : <IconChevronRight size={14} className={classes.chevron} />}
        <FrameworkIcon framework={repo.framework} size={20} />
        <div className={classes.label}>
          <Text size="sm" fw={500} truncate>
            {repo.name}
          </Text>
          <GitBadge status={gitStatuses[repo.id]} compact />
        </div>
        <ProcessStatusDot processes={procs} />
        <div className={classes.rowActions} onClick={(e) => e.stopPropagation()}>
          {primary && <CommandToggle repo={repo} command={primary} onRun={run} />}
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Más acciones">
                <IconDots size={14} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {repo.commands.map((c) => (
                <Menu.Item key={c.id} leftSection={<IconPlayerPlay size={13} />} onClick={() => run(repo, c)}>
                  {c.label}
                </Menu.Item>
              ))}
              {repo.commands.length > 0 && <Menu.Divider />}
              <Menu.Item leftSection={<IconTerminal2 size={13} />} onClick={() => openTerminalAt(repo.path)}>
                Abrir terminal aquí
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      </div>
      {open &&
        repo.commands.map((command) => (
          <div key={command.id} className={classes.child}>
            <ProcessStatusDot processes={[processes[processKey(repo.id, command.id)]].filter((p) => !!p)} keepSpace />
            <Text size="xs" truncate style={{ flex: 1 }} c="gray.4">
              {command.label}
            </Text>
            <CommandToggle repo={repo} command={command} onRun={run} />
          </div>
        ))}
    </div>
  );
}

interface CommandToggleProps {
  repo: Repo;
  command: RepoCommand;
  onRun: (repo: Repo, command: RepoCommand) => void;
}

/** Play/stop button for one command; output goes to the Services tool window. */
function CommandToggle({ repo, command, onRun }: CommandToggleProps) {
  const { processes, revealService } = useProjectContext();
  const proc = processes[processKey(repo.id, command.id)];
  const active = isActive(proc);
  return (
    <Tooltip label={`${active ? "Detener" : "Ejecutar"} ${command.label}`} openDelay={300}>
      <ActionIcon
        variant="subtle"
        color={active ? "red" : "teal"}
        size="sm"
        loading={proc?.status === "stopping"}
        onClick={(e) => {
          e.stopPropagation();
          if (active && proc) {
            stopProcess(proc.id).catch((err) => notifyError(err));
            revealService(proc.id);
          } else onRun(repo, command);
        }}
        aria-label={`${active ? "Detener" : "Ejecutar"} ${command.label}`}
      >
        {active ? <IconPlayerStop size={14} /> : <IconPlayerPlay size={14} />}
      </ActionIcon>
    </Tooltip>
  );
}
