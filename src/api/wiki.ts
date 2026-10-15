import { call } from "./tauri";

export type WikiKind = "folder" | "doc";

/** Emitted when the wiki changes outside the UI (Claude's MCP tools); `paths` are `[path]` or `[from, to]`. */
export const WIKI_CHANGED = "wiki-changed";

export interface WikiChanged {
  projectId: string;
  paths: string[];
}

/** A folder or Markdown document of a project's wiki; `path` is relative to the wiki root. */
export interface WikiNode {
  name: string;
  path: string;
  kind: WikiKind;
  /** Stable id of a document; survives renames and moves. */
  id?: string;
  children?: WikiNode[];
}

/** Reference to paste in a chat; Claude reads the page through its wiki tools. */
export function wikiReference(node: WikiNode): string {
  return `[${node.name.replace(/[[\]]/g, "")}](wiki://${node.id})`;
}

/** Folders and documents of the project's wiki, folders first. */
export function wikiTree(projectId: string): Promise<WikiNode[]> {
  return call("wiki_tree", { projectId });
}

/** Absolute path of the project's wiki folder. */
export function wikiRoot(projectId: string): Promise<string> {
  return call("wiki_root", { projectId });
}

/** Markdown of a document. */
export function wikiRead(projectId: string, path: string): Promise<string> {
  return call("wiki_read", { projectId, path });
}

/** Saves a document's Markdown. */
export function wikiWrite(projectId: string, path: string, content: string): Promise<void> {
  return call("wiki_write", { projectId, path, content });
}

/** Creates a document or folder inside `parent` ("" for the root); returns its path. */
export function wikiCreate(projectId: string, parent: string, name: string, kind: WikiKind): Promise<string> {
  return call("wiki_create", { projectId, parent, name, kind });
}

/** Renames a document or folder; returns its new path. */
export function wikiRename(projectId: string, path: string, name: string): Promise<string> {
  return call("wiki_rename", { projectId, path, name });
}

/** Moves a document or folder into `parent` ("" for the root); returns its new path. */
export function wikiMove(projectId: string, path: string, parent: string): Promise<string> {
  return call("wiki_move", { projectId, path, parent });
}

/** Deletes a document, or a folder with its contents. */
export function wikiDelete(projectId: string, path: string): Promise<void> {
  return call("wiki_delete", { projectId, path });
}

/** Parent folder of a wiki path ("" for the root). */
export function wikiParent(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}
