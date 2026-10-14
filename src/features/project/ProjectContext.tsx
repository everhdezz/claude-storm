import { createContext, useContext } from "react";
import type { Project } from "../../types";
import type { GitStatusMap } from "./useGitStatuses";

export interface ProjectContextValue {
  project: Project;
  gitStatuses: GitStatusMap;
  gitErrors: Record<string, string>;
  refreshGit: (repoId?: string) => Promise<void>;
}

export const ProjectContext = createContext<ProjectContextValue | null>(null);

/** Accesses the project loaded by the surrounding project window. */
export function useProjectContext(): ProjectContextValue {
  const value = useContext(ProjectContext);
  if (!value) throw new Error("useProjectContext must be used inside a project window");
  return value;
}
