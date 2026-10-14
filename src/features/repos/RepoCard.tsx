import { ActionIcon, Card, Group, Menu, Stack, Text, Tooltip } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconDots, IconFolderOpen, IconPencil, IconRefresh, IconTrash, IconWand } from "@tabler/icons-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { ReactNode } from "react";
import { redetectRepo, removeRepo } from "../../api/repos";
import { FrameworkIcon } from "../../components/FrameworkIcon";
import { GitBadge } from "../../components/GitBadge";
import { notifyError } from "../../hooks/notify";
import type { GitStatus, Repo } from "../../types";

interface RepoCardProps {
  projectId: string;
  repo: Repo;
  status: GitStatus | undefined;
  gitError: string | undefined;
  onRefresh: () => void;
  onEdit: () => void;
  children?: ReactNode;
}

/** Dashboard card for one repo: framework, git state, actions and command area. */
export function RepoCard({ projectId, repo, status, gitError, onRefresh, onEdit, children }: RepoCardProps) {
  function confirmRemove() {
    modals.openConfirmModal({
      title: `Quitar ${repo.name} del proyecto`,
      centered: true,
      children: <Text size="sm">La carpeta en disco no se toca.</Text>,
      labels: { confirm: "Quitar", cancel: "Cancelar" },
      confirmProps: { color: "red" },
      onConfirm: () => removeRepo(projectId, repo.id).catch((err) => notifyError(err)),
    });
  }

  function confirmRedetect() {
    modals.openConfirmModal({
      title: "Volver a detectar framework",
      centered: true,
      children: <Text size="sm">Se reemplazarán los comandos actuales por los detectados.</Text>,
      labels: { confirm: "Detectar", cancel: "Cancelar" },
      onConfirm: () => redetectRepo(projectId, repo.id).catch((err) => notifyError(err)),
    });
  }

  return (
    <Card withBorder padding="md" radius="md" id={`repo-${repo.id}`}>
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Group gap="sm" wrap="nowrap" miw={0}>
            <FrameworkIcon framework={repo.framework} size={34} />
            <div style={{ minWidth: 0 }}>
              <Text fw={600} truncate>
                {repo.name}
              </Text>
              <Text size="xs" c="dimmed" truncate ff="monospace" className="selectable">
                {repo.path}
              </Text>
            </div>
          </Group>
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label="Acciones del repo">
                <IconDots size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconPencil size={14} />} onClick={onEdit}>
                Editar comandos
              </Menu.Item>
              <Menu.Item leftSection={<IconWand size={14} />} onClick={confirmRedetect}>
                Volver a detectar
              </Menu.Item>
              <Menu.Item leftSection={<IconFolderOpen size={14} />} onClick={() => revealItemInDir(repo.path)}>
                Mostrar en carpeta
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={confirmRemove}>
                Quitar del proyecto
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
        <Group justify="space-between" wrap="nowrap">
          {gitError ? (
            <Text size="xs" c="red" truncate>
              {gitError}
            </Text>
          ) : (
            <GitBadge status={status} />
          )}
          <Tooltip label="Refrescar git">
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={onRefresh} aria-label="Refrescar git">
              <IconRefresh size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
        {children}
      </Stack>
    </Card>
  );
}
