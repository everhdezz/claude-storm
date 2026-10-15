import { Modal, NavLink, Text } from "@mantine/core";
import { IconBrush, IconCpu, IconSettings2, IconUsers } from "@tabler/icons-react";
import { AccountsSettings } from "./AccountsSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { GeneralSettings } from "./GeneralSettings";
import { ModelsSettings } from "./ModelsSettings";
import classes from "./settings.module.css";
import { t } from "../../i18n";

export type SettingsSection = "accounts" | "models" | "appearance" | "general";

const SECTIONS: { id: SettingsSection; label: string; icon: typeof IconUsers }[] = [
  { id: "accounts", label: t("Claude accounts"), icon: IconUsers },
  { id: "models", label: t("Models"), icon: IconCpu },
  { id: "appearance", label: t("Appearance"), icon: IconBrush },
  { id: "general", label: t("General"), icon: IconSettings2 },
];

interface SettingsModalProps {
  section: SettingsSection | null;
  onSection: (section: SettingsSection) => void;
  onClose: () => void;
}

/** JetBrains-like settings dialog: section list on the left, form on the right. */
export function SettingsModal({ section, onSection, onClose }: SettingsModalProps) {
  return (
    <Modal opened={section !== null} onClose={onClose} title={t("Settings")} size={880} centered padding={0} classNames={{ header: classes.header }}>
      <div className={classes.layout}>
        <nav className={classes.nav}>
          {SECTIONS.map((s) => (
            <NavLink
              key={s.id}
              label={s.label}
              leftSection={<s.icon size={16} stroke={1.6} />}
              active={section === s.id}
              onClick={() => onSection(s.id)}
              variant="filled"
              style={{ borderRadius: 6 }}
            />
          ))}
          <Text size="xs" c="dimmed" mt="auto" px="xs">
            {t("Accounts, models and limits are global to every project.")}
          </Text>
        </nav>
        <div className={classes.content}>
          {section === "accounts" && <AccountsSettings />}
          {section === "models" && <ModelsSettings />}
          {section === "appearance" && <AppearanceSettings />}
          {section === "general" && <GeneralSettings />}
        </div>
      </div>
    </Modal>
  );
}
