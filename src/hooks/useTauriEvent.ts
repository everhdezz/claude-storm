import { useEffect, useRef } from "react";
import { subscribe } from "../api/tauri";

/** Listens to a Tauri event for the lifetime of the component. */
export function useTauriEvent<T>(event: string, handler: (payload: T) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    subscribe<T>(event, (payload) => handlerRef.current(payload)).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [event]);
}
