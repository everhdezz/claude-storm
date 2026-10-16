import { useEffect, useState } from "react";
import { ActionIcon, Group, Menu, ScrollArea, Text, TextInput, Tooltip, UnstyledButton } from "@mantine/core";
import { IconChevronDown, IconFolders, IconSearch, IconSettings } from "@tabler/icons-react";
import { focusWelcomeWindow, listProjects, openProjectWindow } from "../../api/projects";
import { notifyError } from "../../hooks/notify";
import type { ProjectSummary } from "../../types";
import { ProjectAvatar } from "../welcome/ProjectAvatar";
import classes from "./titlebar.module.css";
import { t } from "../../i18n";

const IS_MAC = navigator.userAgent.includes("Mac");

/** WebStorm-like window header: project switcher on the left, draggable empty space. */
interface ProjectTitleBarProps {
  projectId: string;
  projectName: string;
  color: string | null;
  onSettings: () => void;
}

export function ProjectTitleBar({ projectId, projectName, color, onSettings }: ProjectTitleBarProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (menuOpen) listProjects().then(setProjects).catch(() => setProjects([]));
    else setQuery("");
  }, [menuOpen]);

  const needle = query.trim().toLowerCase();
  const visible = projects.filter(
    (p) => p.name.toLowerCase().includes(needle) || (p.rootHint ?? "").toLowerCase().includes(needle),
  );

  async function open(id: string) {
    try {
      await openProjectWindow(id);
    } catch (err) {
      notifyError(err, t("Could not open the project"));
    }
  }

  return (
    <header
      className={classes.bar}
      style={{
        paddingLeft: IS_MAC ? 80 : 10,
        background: color ? `linear-gradient(90deg, ${color}66 0%, ${color}26 38%, transparent 70%)` : undefined,
      }}
      data-tauri-drag-region
    >
      <Menu
        opened={menuOpen}
        onChange={setMenuOpen}
        position="bottom-start"
        width={300}
        withinPortal
        classNames={{ itemLabel: classes.menuItemLabel }}
      >
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
          <TextInput
            data-autofocus
            size="xs"
            m={4}
            mb={6}
            placeholder={t("Search projects")}
            leftSection={<IconSearch size={14} />}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              // Arrow keys fall through to the menu, which moves focus to the first item.
              if (e.key !== "Enter") return;
              const first = visible.find((p) => p.id !== projectId);
              if (first) {
                setMenuOpen(false);
                void open(first.id);
              }
            }}
          />
          <Menu.Label>{t("Recent projects")}</Menu.Label>
          <ScrollArea.Autosize mah={380} type="auto">
            {visible.length === 0 && (
              <Text size="xs" c="dimmed" px="sm" py={6}>
                {t("No projects match “{query}”.", { query: query.trim() })}
              </Text>
            )}
            {visible.map((p) => (
              <Menu.Item
                key={p.id}
                disabled={p.id === projectId}
                leftSection={<ProjectAvatar name={p.name} size={18} />}
                rightSection={p.isOpen && p.id !== projectId ? <Text size="xs" c="dimmed">{t("open")}</Text> : undefined}
                onClick={() => open(p.id)}
              >
                <Text size="sm" truncate>
                  {p.name}
                </Text>
                {p.rootHint && (
                  <Text size="xs" c="dimmed" truncate title={p.rootHint}>
                    {p.rootHint}
                  </Text>
                )}
              </Menu.Item>
            ))}
          </ScrollArea.Autosize>
          <Menu.Divider />
          <Menu.Item leftSection={<IconFolders size={14} />} onClick={() => focusWelcomeWindow()}>
            {t("All projects…")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <div style={{ flex: 1 }} data-tauri-drag-region />
      <Tooltip label={t("Settings")}>
        <ActionIcon variant="subtle" color="gray" onClick={onSettings} aria-label={t("Settings")}>
          <IconSettings size={18} stroke={1.6} />
        </ActionIcon>
      </Tooltip>
    </header>
  );
}
