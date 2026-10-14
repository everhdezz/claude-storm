import classes from "./sessions.module.css";

/** Unified diff with colored added/removed lines. */
export function DiffBlock({ diff }: { diff: string }) {
  return (
    <pre className={`${classes.code} ${classes.diff} selectable`}>
      {diff.split("\n").map((line, i) => (
        <div key={i} className={lineClass(line)}>
          {line || " "}
        </div>
      ))}
    </pre>
  );
}

/** CSS class for a diff line. */
function lineClass(line: string): string | undefined {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) return classes.diffMeta;
  if (line.startsWith("@@")) return classes.diffHunk;
  if (line.startsWith("+")) return classes.diffAdd;
  if (line.startsWith("-")) return classes.diffDel;
  return undefined;
}
