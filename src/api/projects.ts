import type { Project, ProjectSummary } from "../types";
import { call } from "./tauri";

export const PROJECTS_CHANGED = "projects-changed";

/** Lists all saved projects for the welcome window. */
export function listProjects(): Promise<ProjectSummary[]> {
  return call("list_projects");
}

/** Loads a full project with its repos. */
export function getProject(id: string): Promise<Project> {
  return call("get_project", { id });
}

/** Creates a new empty project. */
export function createProject(name: string): Promise<Project> {
  return call("create_project", { name });
}

/** Renames a project. */
export function renameProject(id: string, name: string): Promise<void> {
  return call("rename_project", { id, name });
}

/** Removes a project record without touching files on disk. */
export function deleteProject(id: string): Promise<void> {
  return call("delete_project", { id });
}

/** Opens (or focuses) the dedicated window of a project. */
export function openProjectWindow(id: string): Promise<void> {
  return call("open_project_window", { id });
}

/** Brings the welcome window to the front. */
export function focusWelcomeWindow(): Promise<void> {
  return call("focus_welcome_window");
}
