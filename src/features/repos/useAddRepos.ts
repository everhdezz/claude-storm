import { open } from "@tauri-apps/plugin-dialog";
import { addRepos } from "../../api/repos";
import { notifyError, notifySuccess } from "../../hooks/notify";

/** Action that adds one or several folders picked with the native dialog (Cmd/Shift to multi-select). */
export function useAddFolder(projectId: string) {
  return async function addFolder() {
    try {
      const picked = await open({ directory: true, multiple: true, title: "Selecciona uno o varios repos" });
      const paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
      if (paths.length === 0) return;
      const added = await addRepos(projectId, paths);
      const skipped = paths.length - added.length;
      if (added.length === 0) {
        notifySuccess(paths.length === 1 ? "Ese repo ya estaba en el proyecto" : "Esos repos ya estaban en el proyecto");
        return;
      }
      const note = skipped ? ` (${skipped} ya estaba${skipped > 1 ? "n" : ""})` : "";
      notifySuccess(`Agregado${added.length > 1 ? "s" : ""}: ${added.map((r) => r.name).join(", ")}${note}`);
    } catch (err) {
      notifyError(err, "No se pudieron agregar los repos");
    }
  };
}
