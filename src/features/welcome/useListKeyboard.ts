import { useEffect } from "react";

interface ListKeyboardOptions<T> {
  items: T[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onActivate: (item: T) => void;
}

/** Arrow-key navigation plus Enter to activate, like the JetBrains project list. */
export function useListKeyboard<T>({ items, selectedIndex, onSelectIndex, onActivate }: ListKeyboardOptions<T>): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (items.length === 0 || document.querySelector("[role=dialog]")) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        onSelectIndex(Math.min(items.length - 1, selectedIndex + 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        onSelectIndex(Math.max(0, selectedIndex - 1));
      } else if (event.key === "Enter") {
        const item = items[selectedIndex];
        if (item) onActivate(item);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items, selectedIndex, onSelectIndex, onActivate]);
}
