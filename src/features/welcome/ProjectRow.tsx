import { ActionIcon, Badge, Group, Menu, Text } from "@mantine/core";
import { IconDotsVertical, IconPencil, IconTrash } from "@tabler/icons-react";
import type { ProjectSummary } from "../../types";
import { relativeTime } from "../../utils/time";
import { ProjectAvatar } from "./ProjectAvatar";
import classes from "./welcome.module.css";
import { t, tn } from "../../i18n";

interface ProjectRowProps {
  project: ProjectSummary;
  selected: boolean;
  onSelect: (project: ProjectSummary) => void;
  onOpen: (project: ProjectSummary) => void;
  onRename: (project: ProjectSummary) => void;
  onDelete: (project: ProjectSummary) => void;
}

/** Builds the secondary line: repo count and last opened time. */
function describe(project: ProjectSummary): string {
  const repos = tn(project.repoCount, "{count} repo", "{count} repos");
  return `${repos} · ${project.lastOpenedAt ? t("opened {when}", { when: relativeTime(project.lastOpenedAt) }) : t("never opened")}`;
}

/** One project entry in the welcome list; click opens it in its own window. */
export function ProjectRow({ project, selected, onSelect, onOpen, onRename, onDelete }: ProjectRowProps) {
  return (
    <div
      className={`${classes.row} ${selected ? classes.rowSelected : ""}`}
      onMouseEnter={() => onSelect(project)}
      onClick={() => onOpen(project)}
      role="option"
      aria-selected={selected}
    >
      <ProjectAvatar name={project.name} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Group gap={8} wrap="nowrap">
          <Text fw={500} truncate>
            {project.name}
          </Text>
          {project.isOpen && (
            <Badge size="xs" variant="light" color="teal">
              {t("open")}
            </Badge>
          )}
        </Group>
        <Text size="sm" c="dimmed" truncate>
          {project.rootHint ?? describe(project)}
        </Text>
        {project.rootHint && (
          <Text size="xs" c="dimmed" truncate>
            {describe(project)}
          </Text>
        )}
      </div>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon
            className={classes.rowMenu}
            variant="subtle"
            color="gray"
            aria-label={t("Actions")}
            onClick={(e) => e.stopPropagation()}
          >
            <IconDotsVertical size={18} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
          <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => onRename(project)}>
            {t("Rename")}
          </Menu.Item>
          <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => onDelete(project)}>
            {t("Remove from the list")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}
