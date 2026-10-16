import { call } from "./tauri";

/** One entry of a repo folder; `path` is relative to the repo root, with `/`. */
export interface FileEntry {
  name: string;
  path: string;
  dir: boolean;
}

/** Entries of a folder of a repo ("" for its root), folders first. */
export function repoListDir(projectId: string, repoId: string, path: string): Promise<FileEntry[]> {
  return call("repo_list_dir", { projectId, repoId, path });
}

/** Text of a file of a repo; fails for binaries and very large files. */
export function repoReadFile(projectId: string, repoId: string, path: string): Promise<string> {
  return call("repo_read_file", { projectId, repoId, path });
}

/** Saves the text of an existing file of a repo. */
export function repoWriteFile(projectId: string, repoId: string, path: string, content: string): Promise<void> {
  return call("repo_write_file", { projectId, repoId, path, content });
}
