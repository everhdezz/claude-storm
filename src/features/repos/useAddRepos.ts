import { open } from "@tauri-apps/plugin-dialog";
import { addRepos } from "../../api/repos";
import { notifyError, notifySuccess } from "../../hooks/notify";

/** Opens the native folder picker and returns the chosen path, if any. */
export async function pickFolder(title: string): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false, title });
  return typeof picked === "string" ? picked : null;
}

/** Action that adds one folder picked with the native dialog to the project. */
export function useAddFolder(projectId: string) {
  return async function addFolder() {
    try {
      const path = await pickFolder("Selecciona la carpeta del repo");
      if (!path) return;
      const added = await addRepos(projectId, [path]);
      notifySuccess(added[0] ? `Agregado ${added[0].name}` : "Ese repo ya estaba en el proyecto");
    } catch (err) {
      notifyError(err, "No se pudo agregar el repo");
    }
  };
}
