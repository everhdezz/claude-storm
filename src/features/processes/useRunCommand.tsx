import { Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { checkPort, processKey, startCommand } from "../../api/processes";
import { notifyError } from "../../hooks/notify";
import type { Repo, RepoCommand } from "../../types";
import { useProjectContext } from "../project/ProjectContext";

/** Returns a launcher that checks the port, starts the command and reveals it in Services. */
export function useRunCommand() {
  const { project, revealService } = useProjectContext();

  async function launch(repo: Repo, command: RepoCommand) {
    try {
      await startCommand(project.id, repo.id, command.id);
      revealService(processKey(repo.id, command.id));
    } catch (err) {
      notifyError(err, `No se pudo ejecutar ${command.label}`);
    }
  }

  return async function run(repo: Repo, command: RepoCommand) {
    const port = repo.port;
    if (command.longRunning && port && (await checkPort(port))) {
      modals.openConfirmModal({
        title: `El puerto ${port} ya está ocupado`,
        centered: true,
        children: (
          <Text size="sm">Otro proceso ya escucha en el puerto {port}. Si lo levantas igual probablemente falle o use otro puerto.</Text>
        ),
        labels: { confirm: "Levantar de todos modos", cancel: "Cancelar" },
        onConfirm: () => launch(repo, command),
      });
      return;
    }
    await launch(repo, command);
  };
}
