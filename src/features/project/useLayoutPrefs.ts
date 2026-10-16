import { useEffect, useRef, useState } from "react";

export type LeftTool = "projects" | "chats";
export type BottomTool = "terminal" | "services";
/** What the main area shows; picked on the right stripe, one at a time. */
export type MainView = "chat" | "wiki" | "code";

export interface LayoutPrefs {
  leftTools: LeftTool[];
  bottom: BottomTool | null;
  main: MainView;
  leftWidth: number;
  leftTopHeight: number;
  bottomHeight: number;
}

const ORDER: LeftTool[] = ["projects", "chats"];
const DEFAULTS: LayoutPrefs = { leftTools: ["projects", "chats"], bottom: null, main: "chat", leftWidth: 300, leftTopHeight: 320, bottomHeight: 300 };

/** Tool window visibility and sizes; starts from the project's saved layout and reports every change. */
export function useLayoutPrefs(saved: Partial<LayoutPrefs> | undefined, onChange: (prefs: LayoutPrefs) => void) {
  const [prefs, setPrefs] = useState<LayoutPrefs>(() => ({ ...DEFAULTS, ...saved }));
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
      return { ...p, leftTools: ORDER.filter((t) => next.includes(t)) };
    });
  }

  function toggleBottom(tool: BottomTool) {
    setPrefs((p) => ({ ...p, bottom: p.bottom === tool ? null : tool }));
  }

  function showBottom(tool: BottomTool) {
    setPrefs((p) => ({ ...p, bottom: tool }));
  }

  function showMain(main: MainView) {
    setPrefs((p) => ({ ...p, main }));
  }

  function resize(patch: Partial<Pick<LayoutPrefs, "leftWidth" | "bottomHeight" | "leftTopHeight">>) {
    setPrefs((p) => ({ ...p, ...patch }));
  }

  return { prefs, toggleLeft, toggleBottom, showBottom, showMain, resize };
}
