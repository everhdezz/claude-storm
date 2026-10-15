import { createContext, useContext } from "react";
import type { AppSettings, ClaudeAccount, ProcessInfo, Project, Session } from "../../types";
import type { SettingsSection } from "../settings/SettingsModal";
import type { ProjectUiState } from "./useUiState";
import type { GitStatusMap } from "./useGitStatuses";

export interface ProjectContextValue {
  project: Project;
  gitStatuses: GitStatusMap;
  gitErrors: Record<string, string>;
  refreshGit: (repoId?: string) => Promise<void>;
  processes: Record<string, ProcessInfo>;
  sessions: Session[];
  settings: AppSettings;
  account: ClaudeAccount | null;
  openSettings: (section?: SettingsSection) => void;
  ui: { initial: ProjectUiState; save: (patch: ProjectUiState) => void };
  selectedService: string | null;
  selectService: (processId: string) => void;
  revealService: (processId: string) => void;
  openTerminalAt: (cwd: string) => void;
}

export const ProjectContext = createContext<ProjectContextValue | null>(null);

/** Accesses the project loaded by the surrounding project window. */
export function useProjectContext(): ProjectContextValue {
  const value = useContext(ProjectContext);
  if (!value) throw new Error("useProjectContext must be used inside a project window");
  return value;
}
