import type { ProcessInfo } from "../../types";

/** Picks the most relevant color for a set of processes. */
function dotColor(processes: ProcessInfo[]): string {
  if (processes.some((p) => p.status === "failed")) return "var(--mantine-color-red-6)";
  if (processes.some((p) => p.status === "running" && (p.ready || !p.port))) return "var(--mantine-color-teal-5)";
  if (processes.some((p) => p.status === "running" || p.status === "stopping")) return "var(--mantine-color-yellow-5)";
  return "var(--mantine-color-dark-3)";
}

/** Small colored circle summarizing process state. */
export function ProcessStatusDot({ processes }: { processes: ProcessInfo[] }) {
  if (processes.length === 0) return null;
  return <span style={{ width: 8, height: 8, borderRadius: 4, background: dotColor(processes), display: "inline-block", flexShrink: 0 }} />;
}
