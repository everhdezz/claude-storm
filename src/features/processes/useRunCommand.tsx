import { Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { checkPort, processKey, startCommand } from "../../api/processes";
import { notifyError } from "../../hooks/notify";
import type { Repo, RepoCommand } from "../../types";
import { useProjectContext } from "../project/ProjectContext";
import { t } from "../../i18n";

/** Returns a launcher that checks the port, starts the command and reveals it in Services. */
export function useRunCommand() {
  const { project, revealService, runTarget } = useProjectContext();

  async function launch(repo: Repo, command: RepoCommand, target: string | null) {
    try {
      await startCommand(project.id, repo.id, command.id, target);
      revealService(processKey(repo.id, command.id));
    } catch (err) {
      notifyError(err, t("Could not run {command}", { command: command.label }));
    }
  }

  /** `target` overrides the Services "Correr en" choice (a session id, or null for the main checkout). */
  return async function run(repo: Repo, command: RepoCommand, target: string | null = runTarget) {
    const port = repo.port;
    if (command.longRunning && port && (await checkPort(port))) {
      modals.openConfirmModal({
        title: t("Port {port} is already in use", { port }),
        centered: true,
        children: (
          <Text size="sm">{t("Another process is already listening on port {port}. Starting it anyway will probably fail or use another port.", { port })}</Text>
        ),
        labels: { confirm: t("Start anyway"), cancel: t("Cancel") },
        onConfirm: () => launch(repo, command, target),
      });
      return;
    }
    await launch(repo, command, target);
  };
}
