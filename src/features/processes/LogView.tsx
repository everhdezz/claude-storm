import { useEffect, useRef } from "react";
import { ScrollArea } from "@mantine/core";
import type { LogLine } from "../../types";
import classes from "./processes.module.css";

/** Auto-scrolling monospace log output that stops following when the user scrolls up. */
export function LogView({ lines }: { lines: LogLine[] }) {
  const viewport = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = viewport.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <ScrollArea
      className={classes.logs}
      viewportRef={viewport}
      type="auto"
      onScrollPositionChange={({ y }) => {
        const el = viewport.current;
        if (el) stick.current = el.scrollHeight - el.clientHeight - y < 24;
      }}
    >
      <pre className={`${classes.pre} selectable`}>
        {lines.map((l) => (
          <div key={l.seq} className={classes[l.stream]}>
            {l.text || " "}
          </div>
        ))}
      </pre>
    </ScrollArea>
  );
}
