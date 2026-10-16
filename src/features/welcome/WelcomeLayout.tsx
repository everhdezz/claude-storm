import { ActionIcon, Text } from "@mantine/core";
import { IconSettings } from "@tabler/icons-react";
import { NavLink, Outlet } from "react-router";
import { APP_VERSION, channelLabel } from "../../version";
import appIcon from "../../assets/app-icon.svg";
import classes from "./welcome.module.css";
import { t } from "../../i18n";

interface NavEntry {
  to: string;
  label: string;
}

const NAV: NavEntry[] = [{ to: "/", label: t("Projects") }];

/** Two-column JetBrains-like welcome shell: navigation on the left, active pane on the right. */
export function WelcomeLayout() {
  return (
    <div className={classes.shell}>
      <aside className={classes.sidebar}>
        <div className={classes.brand}>
          <img className={classes.logo} src={appIcon} alt="" />
          <div>
            <Text fw={600} lh={1.2}>
              ClaudeStorm
            </Text>
            <Text size="xs" c="dimmed">
              v{APP_VERSION} · {channelLabel()}
            </Text>
          </div>
        </div>
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end
            className={({ isActive }) => `${classes.navItem} ${isActive ? classes.navItemActive : ""}`}
          >
            {item.label}
          </NavLink>
        ))}
        <div style={{ flex: 1 }} />
        <ActionIcon variant="subtle" color="gray" size="lg" ml={6} aria-label={t("Settings")}>
          <IconSettings size={20} stroke={1.6} />
        </ActionIcon>
      </aside>
      <main className={classes.main}>
        <Outlet />
      </main>
    </div>
  );
}
