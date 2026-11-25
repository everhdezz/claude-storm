import { createContext, useContext } from "react";
import type { AppSettings, ClaudeAccount, ProcessInfo, Project, Session } from "../../types";
import type { SettingsSection } from "../settings/SettingsModal";
import type { ProjectUiState } from "./useUiState";
import type { GitStatusMap } from "./useGitStatuses";
import type { Wiki } from "../wiki/useWiki";
import type { MainTab } from "./useMainTabs";

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
  /** Tab shown in the main area (a chat, a wiki page or a file); its item is highlighted in the left tools. */
  activeTab: MainTab | null;
  /** Opens a chat in a tab (null: the "new chat" home) and puts the cursor in its composer. */
  openChat: (sessionId: string | null) => void;
  /** Closes the tab of a chat (archived or deleted). */
  closeChat: (sessionId: string) => void;
  /** Opens a repo file in a code tab, optionally at a line. */
  openFile: (repoId: string, path: string, line?: number) => void;
  /** Opens a wiki page in a tab. */
  openWikiPage: (path: string) => void;
  /** The wiki tree and its operations. */
  wiki: Wiki;
  /** Isolated session whose worktree the services run in; null runs them in the main checkout. */
  runTarget: string | null;
  setRunTarget: (sessionId: string | null) => void;
}

export const ProjectContext = createContext<ProjectContextValue | null>(null);

/** Accesses the project loaded by the surrounding project window. */
export function useProjectContext(): ProjectContextValue {
  const value = useContext(ProjectContext);
  if (!value) throw new Error("useProjectContext must be used inside a project window");
  return value;
}
