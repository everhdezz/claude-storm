import { useCallback, useEffect, useState } from "react";
import { listProjects, PROJECTS_CHANGED } from "../../api/projects";
import { useTauriEvent } from "../../hooks/useTauriEvent";
import { notifyError } from "../../hooks/notify";
import type { ProjectSummary } from "../../types";

/** Keeps the project list in sync with the backend store. */
export function useProjects() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async function reload() {
    try {
      setProjects(await listProjects());
    } catch (err) {
      notifyError(err, "No se pudieron cargar los proyectos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useTauriEvent(PROJECTS_CHANGED, reload);

  return { projects, loading, reload };
}
