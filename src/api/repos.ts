import type { Detection, GitStatus, Repo, RepoCandidate, RepoPatch } from "../types";
import { call } from "./tauri";

/** Detects the framework of a folder without adding it. */
export function detectRepo(path: string): Promise<Detection> {
  return call("detect_repo", { path });
}

/** Lists git repositories found below a parent folder. */
export function scanRepos(projectId: string, root: string): Promise<RepoCandidate[]> {
  return call("scan_repos", { projectId, root });
}

/** Adds folders to a project. */
export function addRepos(projectId: string, paths: string[]): Promise<Repo[]> {
  return call("add_repos", { projectId, paths });
}

/** Removes a repo from a project without touching disk. */
export function removeRepo(projectId: string, repoId: string): Promise<void> {
  return call("remove_repo", { projectId, repoId });
}

/** Saves a repo's name, port and commands. */
export function updateRepo(projectId: string, repoId: string, patch: RepoPatch): Promise<void> {
  return call("update_repo", { projectId, repoId, patch });
}

/** Re-runs framework detection, replacing commands. */
export function redetectRepo(projectId: string, repoId: string): Promise<void> {
  return call("redetect_repo", { projectId, repoId });
}

/** Reads the working tree status of a repo. */
export function gitStatus(path: string): Promise<GitStatus> {
  return call("git_status", { path });
}
