import { open } from "@tauri-apps/plugin-dialog";
import { addRepos } from "../../api/repos";
import { notifyError, notifySuccess } from "../../hooks/notify";
import { t, tn } from "../../i18n";

/** Action that adds one or several folders picked with the native dialog (Cmd/Shift to multi-select). */
export function useAddFolder(projectId: string) {
  return async function addFolder() {
    try {
      const picked = await open({ directory: true, multiple: true, title: t("Select one or more repos") });
      const paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
      if (paths.length === 0) return;
      const added = await addRepos(projectId, paths);
      const skipped = paths.length - added.length;
      if (added.length === 0) {
        notifySuccess(tn(paths.length, "That repo was already in the project", "Those repos were already in the project"));
        return;
      }
      const note = skipped ? ` ${tn(skipped, "({count} was already there)", "({count} were already there)")}` : "";
      notifySuccess(`${t("Added: {repos}", { repos: added.map((r) => r.name).join(", ") })}${note}`);
    } catch (err) {
      notifyError(err, t("Could not add the repos"));
    }
  };
}
