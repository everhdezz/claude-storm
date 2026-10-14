import { useEffect, useState } from "react";
import { Group, Menu, Text, UnstyledButton } from "@mantine/core";
import { IconChevronDown, IconFolders } from "@tabler/icons-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { focusWelcomeWindow, listProjects, openProjectWindow } from "../../api/projects";
import { notifyError } from "../../hooks/notify";
import type { ProjectSummary } from "../../types";
import { ProjectAvatar } from "../welcome/ProjectAvatar";
import classes from "./titlebar.module.css";

const IS_MAC = navigator.userAgent.includes("Mac");

/** WebStorm-like window header: project switcher on the left, draggable empty space. */
export function ProjectTitleBar({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (menuOpen) listProjects().then(setProjects).catch(() => setProjects([]));
  }, [menuOpen]);

  async function open(id: string) {
    try {
      await openProjectWindow(id);
    } catch (err) {
      notifyError(err, "No se pudo abrir el proyecto");
    }
  }

  return (
    <header
      className={classes.bar}
      style={{ paddingLeft: IS_MAC ? 80 : 10 }}
      data-tauri-drag-region
      onDoubleClick={(e) => e.target === e.currentTarget && getCurrentWindow().toggleMaximize()}
    >
      <Menu opened={menuOpen} onChange={setMenuOpen} position="bottom-start" width={300} withinPortal>
        <Menu.Target>
          <UnstyledButton className={classes.switcher}>
            <Group gap={8} wrap="nowrap">
              <ProjectAvatar name={projectName} size={20} />
              <Text size="sm" fw={600}>
                {projectName}
              </Text>
              <IconChevronDown size={14} stroke={1.8} />
            </Group>
          </UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Proyectos recientes</Menu.Label>
          {projects.map((p) => (
            <Menu.Item
              key={p.id}
              disabled={p.id === projectId}
              leftSection={<ProjectAvatar name={p.name} size={18} />}
              rightSection={p.isOpen && p.id !== projectId ? <Text size="xs" c="dimmed">abierto</Text> : undefined}
              onClick={() => open(p.id)}
            >
              <Text size="sm" truncate>
                {p.name}
              </Text>
              {p.rootHint && (
                <Text size="xs" c="dimmed" truncate>
                  {p.rootHint}
                </Text>
              )}
            </Menu.Item>
          ))}
          <Menu.Divider />
          <Menu.Item leftSection={<IconFolders size={14} />} onClick={() => focusWelcomeWindow()}>
            Todos los proyectos…
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </header>
  );
}
