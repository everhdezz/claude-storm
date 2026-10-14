import type { CSSProperties, ReactNode } from "react";
import classes from "./ide.module.css";

interface IslandProps {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}

/** Rounded panel used for every tool window and the main area (JetBrains "islands"). */
export function Island({ title, actions, children, style, className }: IslandProps) {
  return (
    <section className={`${classes.island} ${className ?? ""}`} style={style}>
      {(title || actions) && (
        <header className={classes.islandHeader}>
          <div className={classes.islandTitle}>{title}</div>
          <div className={classes.islandActions}>{actions}</div>
        </header>
      )}
      <div className={classes.islandBody}>{children}</div>
    </section>
  );
}
