import classes from "./welcome.module.css";

const COLORS = ["#4b6eaf", "#4f9a6b", "#8a5cc7", "#b3863b", "#3d8fa6", "#b2505c", "#6a8f3a", "#5b62c7"];

interface ProjectAvatarProps {
  name: string;
}

/** Builds two-letter initials from words separated by spaces, dashes or underscores. */
export function initials(name: string): string {
  const words = name.split(/[\s\-_.]+/).filter(Boolean);
  const letters = words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : name.slice(0, 2);
  return letters.toUpperCase();
}

/** Picks a stable color for a name. */
function colorFor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length]!;
}

/** Square colored badge with the project initials, JetBrains style. */
export function ProjectAvatar({ name }: ProjectAvatarProps) {
  return (
    <div className={classes.avatar} style={{ background: colorFor(name) }}>
      {initials(name)}
    </div>
  );
}
