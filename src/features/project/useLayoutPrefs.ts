import { useEffect, useState } from "react";

export type LeftTool = "projects" | "chats";
export type BottomTool = "terminal" | "services";

export interface LayoutPrefs {
  left: LeftTool | null;
  bottom: BottomTool | null;
  leftWidth: number;
  bottomHeight: number;
}

const KEY = "devhub.layout";
const DEFAULTS: LayoutPrefs = { left: "projects", bottom: null, leftWidth: 300, bottomHeight: 300 };

/** Reads saved layout preferences, tolerating unavailable storage. */
function load(): LayoutPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
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
    setPrefs((p) => ({ ...p, left: p.left === tool ? null : tool }));
  }

  function toggleBottom(tool: BottomTool) {
    setPrefs((p) => ({ ...p, bottom: p.bottom === tool ? null : tool }));
  }

  function showBottom(tool: BottomTool) {
    setPrefs((p) => ({ ...p, bottom: tool }));
  }

  function resize(patch: Partial<Pick<LayoutPrefs, "leftWidth" | "bottomHeight">>) {
    setPrefs((p) => ({ ...p, ...patch }));
  }

  return { prefs, toggleLeft, toggleBottom, showBottom, resize };
}
