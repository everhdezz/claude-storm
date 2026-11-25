import { useEffect, useRef, useState } from "react";

export type LeftTool = "projects" | "chats" | "wiki";
export type BottomTool = "terminal" | "services";

export interface LayoutPrefs {
  leftTools: LeftTool[];
  bottom: BottomTool | null;
  leftWidth: number;
  /** Height of each stacked left tool; the bottom-most open one takes the rest. */
  leftHeights: Partial<Record<LeftTool, number>>;
  bottomHeight: number;
}

/** Top to bottom, also on the tool stripe: the wiki sits between the files and the chats. */
export const LEFT_ORDER: LeftTool[] = ["projects", "wiki", "chats"];
/** Height a stacked tool starts with until it is resized. */
export const LEFT_DEFAULT_HEIGHT: Record<LeftTool, number> = { projects: 300, wiki: 220, chats: 300 };
const DEFAULTS: LayoutPrefs = { leftTools: ["projects", "chats"], bottom: null, leftWidth: 300, leftHeights: {}, bottomHeight: 300 };

/** Tool window visibility and sizes; starts from the project's saved layout and reports every change. */
export function useLayoutPrefs(saved: Partial<LayoutPrefs> | undefined, onChange: (prefs: LayoutPrefs) => void) {
  const [prefs, setPrefs] = useState<LayoutPrefs>(() => {
    const merged = { ...DEFAULTS, ...saved };
    merged.leftTools = LEFT_ORDER.filter((t) => merged.leftTools.includes(t));
    // Layouts saved with a single splitter: its height belonged to the top tool.
    const legacyTop = (saved as { leftTopHeight?: number } | undefined)?.leftTopHeight;
    if (legacyTop && !saved?.leftHeights && merged.leftTools[0]) merged.leftHeights = { [merged.leftTools[0]]: legacyTop };
    // Layouts saved while the wiki was a main view: it is now a left tool window.
    if ((saved as { main?: string } | undefined)?.main === "wiki" && !merged.leftTools.includes("wiki")) merged.leftTools = [...merged.leftTools, "wiki"];
    return merged;
  });
  const first = useRef(true);
  const report = useRef(onChange);
  report.current = onChange;

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    report.current(prefs);
  }, [prefs]);

  function toggleLeft(tool: LeftTool) {
    setPrefs((p) => {
      const next = p.leftTools.includes(tool) ? p.leftTools.filter((t) => t !== tool) : [...p.leftTools, tool];
      return { ...p, leftTools: LEFT_ORDER.filter((t) => next.includes(t)) };
    });
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

  function resizeLeftTool(tool: LeftTool, height: number) {
    setPrefs((p) => ({ ...p, leftHeights: { ...p.leftHeights, [tool]: height } }));
  }

  return { prefs, toggleLeft, toggleBottom, showBottom, resize, resizeLeftTool };
}
