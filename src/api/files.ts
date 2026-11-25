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

/** A file whose name matches; `positions` are the matched characters of `path`. */
export interface NameHit {
  repoId: string;
  path: string;
  positions: number[];
}

/** A line containing the searched text. */
export interface TextHit {
  repoId: string;
  path: string;
  line: number;
  text: string;
}

/** Files whose name fuzzy-matches `query` in the given repos (all repos when empty), best first. */
export function searchFileNames(projectId: string, repoIds: string[], query: string): Promise<NameHit[]> {
  return call("search_file_names", { projectId, repoIds, query });
}

/** Lines containing `query` in the given repos (all repos when empty). */
export function searchInFiles(projectId: string, repoIds: string[], query: string, caseSensitive: boolean): Promise<TextHit[]> {
  return call("search_in_files", { projectId, repoIds, query, caseSensitive });
}
