import { Menu, Text, UnstyledButton } from "@mantine/core";
import { IconCheck, IconChevronDown, IconSettings, IconUserCircle } from "@tabler/icons-react";
import { ACCOUNT_KIND_LABELS, setProjectAccount } from "../../api/settings";
import { notifyError } from "../../hooks/notify";
import { useProjectContext } from "../project/ProjectContext";
import { t } from "../../i18n";

/** Link-style picker of the project's Claude account; changing it applies to the whole project. */
export function AccountLink({ size = "xs" }: { size?: "xs" | "sm" }) {
  const { project, account, settings, openSettings } = useProjectContext();

  function choose(accountId: string) {
    setProjectAccount(project.id, accountId).catch((err) => notifyError(err, t("Could not change the account")));
  }

  return (
    <Menu position="top-start" withinPortal width={260}>
      <Menu.Target>
        <UnstyledButton onClick={(e) => e.stopPropagation()}>
          <Text
            size={size}
            c={account ? "indigo.3" : "yellow.5"}
            td="underline"
            style={{ textUnderlineOffset: 3, display: "inline-flex", alignItems: "center", gap: 3 }}
          >
            {account ? account.alias : t("Choose a Claude account")}
            <IconChevronDown size={11} />
          </Text>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{t("This project's Claude account")}</Menu.Label>
        {settings.accounts.length === 0 && (
          <Text size="xs" c="dimmed" px="sm" py={4}>
            {t("No accounts yet.")}
          </Text>
        )}
        {settings.accounts.map((a) => (
          <Menu.Item
            key={a.id}
            leftSection={a.id === account?.id ? <IconCheck size={14} /> : <IconUserCircle size={14} />}
            onClick={() => choose(a.id)}
          >
            <Text size="sm">{a.alias}</Text>
            <Text size="xs" c="dimmed">
              {ACCOUNT_KIND_LABELS[a.kind]}
              {a.tokenHint ? ` · ${a.tokenHint}` : ""}
            </Text>
          </Menu.Item>
        ))}
        <Menu.Divider />
        <Menu.Item leftSection={<IconSettings size={14} />} onClick={() => openSettings("accounts")}>
          {t("Manage accounts…")}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
