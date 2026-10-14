import { useCallback, useEffect, useState } from "react";
import { getProject, PROJECTS_CHANGED } from "../../api/projects";
import { useTauriEvent } from "../../hooks/useTauriEvent";
import type { Project } from "../../types";

/** Loads a project and refreshes it whenever the store changes. */
export function useProject(projectId: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    async function reload() {
      try {
        setProject(await getProject(projectId));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [projectId],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  useTauriEvent(PROJECTS_CHANGED, reload);

  return { project, error, reload };
}
