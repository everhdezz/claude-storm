import type { BranchList, Detection, GitStatus, LayoutItem, Repo, RepoPatch } from "../types";
import { call } from "./tauri";

/** Detects the framework of a folder without adding it. */
export function detectRepo(path: string): Promise<Detection> {
  return call("detect_repo", { path });
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

/** Saves the order and grouping of a project's repos. */
export function saveRepoLayout(projectId: string, layout: LayoutItem[]): Promise<void> {
  return call("save_repo_layout", { projectId, layout });
}

/** Lists local, remote and recently used branches of a repo. */
export function gitBranches(path: string): Promise<BranchList> {
  return call("git_branches", { path });
}

/** Checks out a branch; remote ones get a local tracking branch. */
export function gitCheckout(path: string, name: string, remote: boolean): Promise<void> {
  return call("git_checkout", { path, name, remote });
}

/** Creates a branch from `start` (HEAD when null), optionally checking it out. */
export function gitCreateBranch(path: string, name: string, start: string | null, checkout: boolean): Promise<void> {
  return call("git_create_branch", { path, name, start, checkout });
}

/** Renames a local branch. */
export function gitRenameBranch(path: string, from: string, to: string): Promise<void> {
  return call("git_rename_branch", { path, from, to });
}

/** Deletes a local branch; `force` drops unmerged commits too. */
export function gitDeleteBranch(path: string, name: string, force: boolean): Promise<void> {
  return call("git_delete_branch", { path, name, force });
}

/** Merges a branch into the current one. */
export function gitMerge(path: string, name: string): Promise<string> {
  return call("git_merge", { path, name });
}

/** Fetches every remote, pruning deleted branches. */
export function gitFetch(path: string): Promise<void> {
  return call("git_fetch", { path });
}

/** Fast-forward pull of the current branch. */
export function gitPull(path: string): Promise<string> {
  return call("git_pull", { path });
}
