import { arrayMove } from "@dnd-kit/sortable";
import type { LayoutItem } from "../../types";

export const INDENT = 18;

/** One visible row of the repo tree. */
export interface FlatItem {
  id: string;
  kind: "repo" | "group";
  depth: 0 | 1;
  parentId: string | null;
  repoId?: string;
  groupId?: string;
  name?: string;
  collapsed?: boolean;
}

/** Node id of a repo row. */
export function repoNode(repoId: string): string {
  return `repo:${repoId}`;
}

/** Node id of a group row. */
export function groupNode(groupId: string): string {
  return `group:${groupId}`;
}

/** Flattens the layout into visible rows; children of collapsed groups (or of `hideChildrenOf`) are skipped. */
export function flatten(layout: LayoutItem[], hideChildrenOf?: string): FlatItem[] {
  const rows: FlatItem[] = [];
  for (const item of layout) {
    if (item.kind === "repo") {
      rows.push({ id: repoNode(item.repoId), kind: "repo", depth: 0, parentId: null, repoId: item.repoId });
      continue;
    }
    const id = groupNode(item.id);
    rows.push({ id, kind: "group", depth: 0, parentId: null, groupId: item.id, name: item.name, collapsed: item.collapsed });
    if (item.collapsed || id === hideChildrenOf) continue;
    for (const repoId of item.repoIds) {
      rows.push({ id: repoNode(repoId), kind: "repo", depth: 1, parentId: id, repoId });
    }
  }
  return rows;
}

/** Where the dragged row would land: its depth and parent group. */
export interface Projection {
  depth: 0 | 1;
  parentId: string | null;
}

/** Computes the target depth from the horizontal drag offset and the neighbours at the drop position. */
export function project(items: FlatItem[], activeId: string, overId: string, offsetX: number): Projection {
  const activeIndex = items.findIndex((i) => i.id === activeId);
  const overIndex = items.findIndex((i) => i.id === overId);
  const active = items[activeIndex];
  if (!active || active.kind === "group" || overIndex < 0) return { depth: 0, parentId: null };
  const moved = arrayMove(items, activeIndex, overIndex);
  const prev = moved[overIndex - 1];
  const next = moved[overIndex + 1];
  const wanted = active.depth + Math.round(offsetX / INDENT);
  const maxDepth = prev && (prev.kind === "group" || prev.depth === 1) ? 1 : 0;
  const minDepth = next && next.depth === 1 && next.parentId !== null ? 1 : 0;
  const depth = Math.min(maxDepth, Math.max(minDepth, wanted)) as 0 | 1;
  if (depth === 0 || !prev) return { depth: 0, parentId: null };
  return { depth: 1, parentId: prev.kind === "group" ? prev.id : prev.parentId };
}

/** Applies a finished drag and rebuilds the layout, keeping hidden children inside their groups. */
export function applyMove(layout: LayoutItem[], activeId: string, overId: string, projection: Projection): LayoutItem[] {
  const hideChildrenOf = activeId.startsWith("group:") ? activeId : undefined;
  const items = flatten(layout, hideChildrenOf);
  const activeIndex = items.findIndex((i) => i.id === activeId);
  const overIndex = items.findIndex((i) => i.id === overId);
  if (activeIndex < 0 || overIndex < 0) return layout;
  const moved = arrayMove(items, activeIndex, overIndex).map((i) =>
    i.id === activeId ? { ...i, depth: projection.depth, parentId: projection.parentId } : i,
  );
  return rebuild(moved, layout);
}

/** Turns visible rows back into a layout, re-attaching children that were not visible. */
function rebuild(rows: FlatItem[], previous: LayoutItem[]): LayoutItem[] {
  const groups = new Map<string, Extract<LayoutItem, { kind: "group" }>>();
  const out: LayoutItem[] = [];
  const visibleRepos = new Set(rows.filter((r) => r.kind === "repo").map((r) => r.repoId!));
  for (const row of rows) {
    if (row.kind === "group") {
      const before = previous.find((p) => p.kind === "group" && p.id === row.groupId) as Extract<LayoutItem, { kind: "group" }>;
      const hidden = before.repoIds.filter((id) => !visibleRepos.has(id));
      const group = { ...before, repoIds: hidden };
      groups.set(row.id, group);
      out.push(group);
    }
  }
  const result: LayoutItem[] = [];
  for (const row of rows) {
    if (row.kind === "group") {
      result.push(groups.get(row.id)!);
    } else if (row.depth === 1 && row.parentId && groups.has(row.parentId)) {
      groups.get(row.parentId)!.repoIds.push(row.repoId!);
    } else {
      result.push({ kind: "repo", repoId: row.repoId! });
    }
  }
  return result;
}

/** Moves a repo into a group (appended) or out to the top level (after its old group). */
export function moveRepoToGroup(layout: LayoutItem[], repoId: string, groupId: string | null): LayoutItem[] {
  let insertAfter = -1;
  const stripped = layout
    .map((item, index) => {
      if (item.kind === "group" && item.repoIds.includes(repoId)) {
        insertAfter = index;
        return { ...item, repoIds: item.repoIds.filter((r) => r !== repoId) };
      }
      return item;
    })
    .filter((item) => !(item.kind === "repo" && item.repoId === repoId));
  if (groupId) {
    return stripped.map((item) => (item.kind === "group" && item.id === groupId ? { ...item, repoIds: [...item.repoIds, repoId] } : item));
  }
  const at = insertAfter >= 0 ? insertAfter + 1 : stripped.length;
  return [...stripped.slice(0, at), { kind: "repo", repoId }, ...stripped.slice(at)];
}

/** Dissolves a group, leaving its repos in its place. */
export function ungroup(layout: LayoutItem[], groupId: string): LayoutItem[] {
  return layout.flatMap((item) =>
    item.kind === "group" && item.id === groupId ? item.repoIds.map((repoId) => ({ kind: "repo" as const, repoId })) : [item],
  );
}

/** Updates one group in place. */
export function patchGroup(layout: LayoutItem[], groupId: string, patch: Partial<{ name: string; collapsed: boolean }>): LayoutItem[] {
  return layout.map((item) => (item.kind === "group" && item.id === groupId ? { ...item, ...patch } : item));
}
