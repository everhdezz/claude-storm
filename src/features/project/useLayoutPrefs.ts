import { useEffect, useState } from "react";

export type LeftTool = "projects" | "chats";
export type BottomTool = "terminal" | "services";

export interface LayoutPrefs {
  leftTools: LeftTool[];
  bottom: BottomTool | null;
  leftWidth: number;
  leftTopHeight: number;
  bottomHeight: number;
}

/** Storage key kept from the former app name so saved layouts survive the rename. */
const KEY = "devhub.layout";
const ORDER: LeftTool[] = ["projects", "chats"];
const DEFAULTS: LayoutPrefs = { leftTools: ["projects"], bottom: null, leftWidth: 300, leftTopHeight: 320, bottomHeight: 300 };

/** Reads saved layout preferences (migrating the old single `left` tool), tolerating unavailable storage. */
function load(): LayoutPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const saved = JSON.parse(raw) as Partial<LayoutPrefs> & { left?: LeftTool | null };
    const leftTools = saved.leftTools ?? (saved.left ? [saved.left] : saved.left === null ? [] : DEFAULTS.leftTools);
    return { ...DEFAULTS, ...saved, leftTools };
  } catch {
    return DEFAULTS;
  }
}

/** Tool window visibility and sizes, remembered across launches. */
export function useLayoutPrefs() {
  const [prefs, setPrefs] = useState<LayoutPrefs>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      return;
    }
  }, [prefs]);

  function toggleLeft(tool: LeftTool) {
    setPrefs((p) => {
      const on = p.leftTools.includes(tool);
      const next = on ? p.leftTools.filter((t) => t !== tool) : [...p.leftTools, tool];
      return { ...p, leftTools: ORDER.filter((t) => next.includes(t)) };
    });
  }

  function showLeft(tool: LeftTool) {
    setPrefs((p) => (p.leftTools.includes(tool) ? p : { ...p, leftTools: ORDER.filter((t) => t === tool || p.leftTools.includes(t)) }));
  }

  function toggleBottom(tool: BottomTool) {
    setPrefs((p) => ({ ...p, bottom: p.bottom === tool ? null : tool }));
  }

  function showBottom(tool: BottomTool) {
    setPrefs((p) => ({ ...p, bottom: tool }));
  }

  function resize(patch: Partial<Pick<LayoutPrefs, "leftWidth" | "bottomHeight" | "leftTopHeight">>) {
    setPrefs((p) => ({ ...p, ...patch }));
  }

  return { prefs, toggleLeft, showLeft, toggleBottom, showBottom, resize };
}
