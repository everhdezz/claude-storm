import { useRef } from "react";
import classes from "./ide.module.css";

interface SplitterProps {
  direction: "horizontal" | "vertical";
  value: number;
  min: number;
  max: number;
  invert?: boolean;
  onChange: (value: number) => void;
}

/** Invisible drag handle placed in the gap between two islands to resize them. */
export function Splitter({ direction, value, min, max, invert = false, onChange }: SplitterProps) {
  const start = useRef<{ pointer: number; value: number } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { pointer: direction === "horizontal" ? e.clientX : e.clientY, value };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const delta = (direction === "horizontal" ? e.clientX : e.clientY) - start.current.pointer;
    const next = start.current.value + (invert ? -delta : delta);
    onChange(Math.min(max, Math.max(min, next)));
  }

  function onPointerUp() {
    start.current = null;
  }

  return (
    <div
      className={direction === "horizontal" ? classes.splitterH : classes.splitterV}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}
