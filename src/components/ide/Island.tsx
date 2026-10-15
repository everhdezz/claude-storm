import type { CSSProperties, ReactNode } from "react";
import { ActionIcon, Tooltip } from "@mantine/core";
import { IconMinus } from "@tabler/icons-react";
import classes from "./ide.module.css";
import { t } from "../../i18n";

interface IslandProps {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
  /** Shows a minimize button that hides the island back into the tool stripe. */
  onMinimize?: () => void;
}

/** Rounded panel used for every tool window and the main area (JetBrains "islands"). */
export function Island({ title, actions, children, style, className, onMinimize }: IslandProps) {
  return (
    <section className={`${classes.island} ${className ?? ""}`} style={style}>
      {(title || actions || onMinimize) && (
        <header className={classes.islandHeader}>
          <div className={classes.islandTitle}>{title}</div>
          <div className={classes.islandActions}>
            {actions}
            {onMinimize && (
              <Tooltip label={t("Minimize")}>
                <ActionIcon variant="subtle" color="gray" size="sm" onClick={onMinimize} aria-label={t("Minimize")}>
                  <IconMinus size={15} />
                </ActionIcon>
              </Tooltip>
            )}
          </div>
        </header>
      )}
      <div className={classes.islandBody}>{children}</div>
    </section>
  );
}
