import { useEffect, useState } from "react";
import { clearProcessLogs, PROCESS_LOG, processLogs } from "../../api/processes";
import { useTauriEvent } from "../../hooks/useTauriEvent";
import type { LogEvent, LogLine } from "../../types";

const MAX_LINES = 3000;

/** Loads the buffered output of a process and appends new lines as they arrive. */
export function useProcessLogs(processId: string | null, runKey: string | undefined) {
  const [lines, setLines] = useState<LogLine[]>([]);

  useEffect(() => {
    setLines([]);
    if (!processId) return;
    let cancelled = false;
    processLogs(processId).then((buffered) => {
      if (!cancelled) setLines((live) => mergeLines(buffered, live));
    });
    return () => {
      cancelled = true;
    };
  }, [processId, runKey]);

  useTauriEvent<LogEvent>(PROCESS_LOG, (event) => {
    if (event.processId !== processId) return;
    setLines((prev) => {
      const next = prev.length >= MAX_LINES ? prev.slice(prev.length - MAX_LINES + 1) : prev.slice();
      next.push(event.line);
      return next;
    });
  });

  async function clear() {
    if (!processId) return;
    await clearProcessLogs(processId);
    setLines([]);
  }

  return { lines, clear };
}

/** Merges a fetched buffer with lines received while it was loading, without duplicates. */
function mergeLines(buffered: LogLine[], live: LogLine[]): LogLine[] {
  const last = buffered.at(-1)?.seq ?? -1;
  return [...buffered, ...live.filter((l) => l.seq > last)];
}
