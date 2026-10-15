import { useState } from "react";
import { ActionIcon, Loader, Menu, Tooltip } from "@mantine/core";
import { IconCode, IconFolderOpen, IconPlayerPlay, IconTerminal2 } from "@tabler/icons-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { sessionFolders } from "../../api/sessions";
import { openInEditor } from "../../api/settings";
import { notifyError } from "../../hooks/notify";
import type { Session, SessionFolder } from "../../types";
import { useProjectContext } from "../project/ProjectContext";
import { t } from "../../i18n";

/** Header buttons of an isolated session: run services in its worktree and open the worktree elsewhere. */
export function WorktreeActions({ session }: { session: Session }) {
  const { settings, runTarget, setRunTarget, openTerminalAt } = useProjectContext();
  const [folders, setFolders] = useState<SessionFolder[] | null>(null);
  const runningHere = runTarget === session.id;

  async function load() {
    try {
      setFolders(await sessionFolders(session.id));
    } catch (err) {
      notifyError(err, t("The worktrees were not found"));
    }
  }

  return (
    <>
      <Tooltip label={runningHere ? t("Services run in this worktree · back to the main checkout") : t("Run the services in this worktree")}>
        <ActionIcon
          variant={runningHere ? "light" : "subtle"}
          color={runningHere ? "teal" : "gray"}
          onClick={() => setRunTarget(runningHere ? null : session.id)}
          aria-label={t("Run the services in this worktree")}
        >
          <IconPlayerPlay size={17} />
        </ActionIcon>
      </Tooltip>
      <Menu position="bottom-end" withinPortal onOpen={load}>
        <Menu.Target>
          <Tooltip label={t("Open worktree")}>
            <ActionIcon variant="subtle" color="gray" aria-label={t("Open worktree")}>
              <IconFolderOpen size={17} />
            </ActionIcon>
          </Tooltip>
        </Menu.Target>
        <Menu.Dropdown>
          {!folders && <Loader size="xs" m="sm" />}
          {folders?.map((f) => (
            <div key={f.repoId}>
              {folders.length > 1 && <Menu.Label>{f.repoName}</Menu.Label>}
              <Menu.Item
                leftSection={<IconCode size={14} />}
                disabled={!f.exists}
                onClick={() => openInEditor(f.path).catch((e) => notifyError(e))}
              >
                {t("Open in {editor}", { editor: settings.editor })}
              </Menu.Item>
              <Menu.Item leftSection={<IconTerminal2 size={14} />} disabled={!f.exists} onClick={() => openTerminalAt(f.path)}>
                {t("Terminal here")}
              </Menu.Item>
              <Menu.Item leftSection={<IconFolderOpen size={14} />} disabled={!f.exists} onClick={() => revealItemInDir(f.path)}>
                {t("Show in Finder")}
              </Menu.Item>
            </div>
          ))}
        </Menu.Dropdown>
      </Menu>
    </>
  );
}
