import { useCallback, useEffect, useMemo, useRef } from "react";
import { saveProjectUiState } from "../../api/projects";
import type { LayoutPrefs } from "./useLayoutPrefs";
import type { WikiUiState } from "../wiki/WikiView";
import type { CodeUiState } from "../code/CodeView";

/** Everything a project window restores when it is reopened. */
export interface ProjectUiState {
  layout?: Partial<LayoutPrefs>;
  sessionId?: string | null;
  selectedService?: string | null;
  terminals?: { tabs: { cwd: string; title: string }[]; active: number };
  expandedRepos?: string[];
  showArchived?: boolean;
  runTarget?: string | null;
  wiki?: WikiUiState;
  code?: CodeUiState;
}

const DEBOUNCE_MS = 400;

/** Initial UI state of a project plus a debounced, merging saver backed by the app data file. */
export function useUiState(projectId: string, stored: unknown) {
  const initial = useRef<ProjectUiState>((stored as ProjectUiState | null) ?? {});
  const pending = useRef<ProjectUiState>({ ...initial.current });
  const timer = useRef<number | undefined>(undefined);

  const flush = useCallback(
    function flush() {
      window.clearTimeout(timer.current);
      timer.current = undefined;
      saveProjectUiState(projectId, pending.current).catch(() => undefined);
    },
    [projectId],
  );

  const save = useCallback(
    function save(patch: ProjectUiState) {
      pending.current = { ...pending.current, ...patch };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, DEBOUNCE_MS);
    },
    [flush],
  );

  useEffect(() => {
    window.addEventListener("beforeunload", onUnload);
    function onUnload() {
      if (timer.current !== undefined) flush();
    }
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      if (timer.current !== undefined) flush();
    };
  }, [flush]);

  return useMemo(() => ({ initial: initial.current, save }), [save]);
}
