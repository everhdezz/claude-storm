import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/** Native file drag & drop over the window (gives real paths); `onDrop` receives the dropped files. */
export function useFileDrop(enabled: boolean, onDrop: (paths: string[]) => void) {
  const [dragging, setDragging] = useState(false);
  const handler = useRef(onDrop);
  handler.current = onDrop;

  useEffect(() => {
    if (!enabled) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    try {
      getCurrentWebview()
        .onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "enter" || payload.type === "over") setDragging(true);
          else if (payload.type === "leave") setDragging(false);
          else if (payload.type === "drop") {
            setDragging(false);
            if (payload.paths.length) handler.current(payload.paths);
          }
        })
        .then((fn) => (disposed ? fn() : (unlisten = fn)))
        .catch(() => undefined);
    } catch {
      return;
    }
    return () => {
      disposed = true;
      unlisten?.();
      setDragging(false);
    };
  }, [enabled]);

  return dragging;
}
