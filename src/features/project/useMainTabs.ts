import { useEffect, useRef, useState } from "react";

/** A tab of the main area: a chat (null = the "new chat" home), a wiki page or a repo file. */
export type MainTab =
  | { kind: "chat"; sessionId: string | null }
  | { kind: "wiki"; path: string }
  | { kind: "code"; repoId: string; path: string };

/** What the main area remembers per project window. */
export interface TabsUiState {
  tabs: MainTab[];
  active: string | null;
}

export function tabKey(tab: MainTab): string {
  if (tab.kind === "chat") return `chat:${tab.sessionId ?? "new"}`;
  if (tab.kind === "wiki") return `wiki:${tab.path}`;
  return `code:${tab.repoId}:${tab.path}`;
}

/** `path` after `from` was renamed or moved to `to` (unchanged if unrelated). */
export function remapPath(path: string, from: string, to: string): string {
  if (path === from) return to;
  return path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
}

/** Open tabs and the active one, in WebStorm style: opening an open item just focuses its tab. */
export function useMainTabs(initial: TabsUiState, onChange: (state: TabsUiState) => void) {
  const [state, setState] = useState<TabsUiState>(initial);
  const report = useRef(onChange);
  report.current = onChange;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    report.current(state);
  }, [state]);

  /** Focuses the tab, opening it right after the active one when it is not open yet. */
  function open(tab: MainTab) {
    const key = tabKey(tab);
    setState((s) => {
      if (s.tabs.some((t) => tabKey(t) === key)) return { ...s, active: key };
      const at = s.tabs.findIndex((t) => tabKey(t) === s.active);
      const tabs = [...s.tabs];
      tabs.splice(at < 0 ? tabs.length : at + 1, 0, tab);
      return { tabs, active: key };
    });
  }

  /** Puts `tab` in place of the tab `key` (the "new chat" tab becomes the chat it created). */
  function replace(key: string, tab: MainTab) {
    const next = tabKey(tab);
    setState((s) => {
      const tabs = s.tabs.filter((t) => tabKey(t) !== next).map((t) => (tabKey(t) === key ? tab : t));
      return { tabs, active: s.active === key ? next : s.active };
    });
  }

  function activate(key: string) {
    setState((s) => (s.active === key ? s : { ...s, active: key }));
  }

  /** Closes every tab matching `match`; an active one hands the focus to its right neighbour (else left). */
  function closeWhere(match: (tab: MainTab) => boolean) {
    setState((s) => {
      if (!s.tabs.some(match)) return s;
      let active = s.active;
      const activeIndex = s.tabs.findIndex((t) => tabKey(t) === s.active);
      if (activeIndex >= 0 && match(s.tabs[activeIndex]!)) {
        const right = s.tabs.slice(activeIndex + 1).find((t) => !match(t));
        const left = s.tabs.slice(0, activeIndex).reverse().find((t) => !match(t));
        const next = right ?? left;
        active = next ? tabKey(next) : null;
      }
      return { tabs: s.tabs.filter((t) => !match(t)), active };
    });
  }

  function close(key: string) {
    closeWhere((t) => tabKey(t) === key);
  }

  /** Follows a wiki page or folder that was renamed or moved. */
  function relocateWiki(from: string, to: string) {
    setState((s) => {
      const tabs = s.tabs.map((t) => (t.kind === "wiki" ? { ...t, path: remapPath(t.path, from, to) } : t));
      const activeTab = s.tabs.findIndex((t) => tabKey(t) === s.active);
      return { tabs, active: activeTab >= 0 ? tabKey(tabs[activeTab]!) : s.active };
    });
  }

  const activeTab = state.tabs.find((t) => tabKey(t) === state.active) ?? null;
  return { tabs: state.tabs, active: state.active, activeTab, open, replace, activate, close, closeWhere, relocateWiki };
}

export type MainTabs = ReturnType<typeof useMainTabs>;

/**
 * Tab labels; tabs sharing a name also get the shortest parent path that tells them apart, like
 * WebStorm: `repo › folder` for files, `Wiki › folder` for pages.
 */
export function tabLabels(items: { key: string; name: string; parents: string[] }[]): Map<string, { name: string; hint: string | null }> {
  const labels = new Map<string, { name: string; hint: string | null }>();
  const groups = new Map<string, typeof items>();
  for (const item of items) groups.set(item.name, [...(groups.get(item.name) ?? []), item]);
  for (const group of groups.values()) {
    if (group.length === 1) {
      labels.set(group[0]!.key, { name: group[0]!.name, hint: null });
      continue;
    }
    const deepest = Math.max(...group.map((i) => i.parents.length));
    let depth = 1;
    while (depth < deepest && new Set(group.map((i) => i.parents.slice(-depth).join("/"))).size < group.length) depth++;
    for (const item of group) {
      const hint = item.parents.slice(-depth).join(" › ");
      labels.set(item.key, { name: item.name, hint: hint || null });
    }
  }
  return labels;
}
