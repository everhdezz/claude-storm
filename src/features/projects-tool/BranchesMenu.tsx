import { useState, type ReactNode } from "react";
import { Group, Loader, Menu, Text, TextInput, UnstyledButton } from "@mantine/core";
import { modals } from "@mantine/modals";
import {
  IconArrowDown,
  IconCloud,
  IconCloudDownload,
  IconCode,
  IconGitBranch,
  IconGitMerge,
  IconPencil,
  IconPlus,
  IconSearch,
  IconStarFilled,
  IconTerminal2,
  IconTrash,
} from "@tabler/icons-react";
import {
  gitBranches,
  gitCheckout,
  gitCreateBranch,
  gitDeleteBranch,
  gitFetch,
  gitMerge,
  gitPull,
  gitRenameBranch,
} from "../../api/repos";
import { openInEditor } from "../../api/settings";
import { errorMessage } from "../../api/tauri";
import { notifyError, notifySuccess } from "../../hooks/notify";
import { promptText } from "../../hooks/promptText";
import type { BranchInfo, BranchList, Repo } from "../../types";
import { useProjectContext } from "../project/ProjectContext";
import classes from "./projects-tool.module.css";
import { t } from "../../i18n";

/** WebStorm-like branches popup: search, recent/local/remote branches, each with its own actions submenu. */
export function BranchesMenu({ repo, children }: { repo: Repo; children: ReactNode }) {
  const { refreshGit } = useProjectContext();
  const [list, setList] = useState<BranchList | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  async function load() {
    setLoading(true);
    try {
      setList(await gitBranches(repo.path));
    } catch (err) {
      notifyError(err, t("Could not read the branches"));
    } finally {
      setLoading(false);
    }
  }

  /** Runs a git operation, then refreshes the badge and the list. */
  async function act(label: string, op: () => Promise<unknown>, success?: string) {
    try {
      await op();
      if (success) notifySuccess(success);
    } catch (err) {
      notifyError(err, label);
    } finally {
      refreshGit(repo.id);
    }
  }

  async function newBranch(from: string | null) {
    const result = await promptText({
      title: from ? t("New branch from {branch}", { branch: from }) : t("New branch"),
      label: t("Name"),
      confirm: t("Create"),
      checkbox: { label: t("Check it out"), initial: true },
    });
    if (result) act(t("Could not create the branch"), () => gitCreateBranch(repo.path, result.value, from, result.checked), t("Branch {branch} created", { branch: result.value }));
  }

  async function rename(branch: BranchInfo) {
    const result = await promptText({ title: t("Rename {branch}", { branch: branch.name }), label: t("New name"), initial: branch.name, confirm: t("Rename") });
    if (result && result.value !== branch.name) act(t("Could not rename"), () => gitRenameBranch(repo.path, branch.name, result.value));
  }

  function remove(branch: BranchInfo) {
    modals.openConfirmModal({
      title: t("Delete {branch}", { branch: branch.name }),
      centered: true,
      children: <Text size="sm">{t("The local branch is deleted. If it has unmerged commits, you will be asked again.")}</Text>,
      labels: { confirm: t("Delete"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () =>
        gitDeleteBranch(repo.path, branch.name, false)
          .then(() => refreshGit(repo.id))
          .catch((err) => (/not fully merged/i.test(errorMessage(err)) ? confirmForce(branch) : notifyError(err, t("Could not delete")))),
    });
  }

  function confirmForce(branch: BranchInfo) {
    modals.openConfirmModal({
      title: t("{branch} is not merged", { branch: branch.name }),
      centered: true,
      children: <Text size="sm">{t("It has commits that are not in the current branch. If you delete it, they are lost.")}</Text>,
      labels: { confirm: t("Delete anyway"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () => act(t("Could not delete"), () => gitDeleteBranch(repo.path, branch.name, true)),
    });
  }

  const current = list?.current ?? null;
  const q = query.trim().toLowerCase();
  const matches = (b: BranchInfo) => !q || b.name.toLowerCase().includes(q);
  const branches = list?.branches.filter(matches) ?? [];
  const locals = branches.filter((b) => !b.remote);
  const remotes = branches.filter((b) => b.remote);
  const recent = (list?.recent ?? []).map((name) => locals.find((b) => b.name === name)).filter((b): b is BranchInfo => !!b);

  function row(branch: BranchInfo, keyPrefix: string) {
    return (
      <BranchRow
        key={`${keyPrefix}-${branch.name}`}
        branch={branch}
        current={current}
        onCheckout={() => act(t("Could not check out"), () => gitCheckout(repo.path, branch.name, branch.remote))}
        onNewFrom={() => newBranch(branch.name)}
        onMerge={() => act(t("Could not merge"), () => gitMerge(repo.path, branch.name), t("{branch} merged into {current}", { branch: branch.name, current: current ?? "" }))}
        onRename={() => rename(branch)}
        onDelete={() => remove(branch)}
      />
    );
  }

  return (
    <Menu
      position="bottom-start"
      width={340}
      shadow="md"
      withinPortal
      onOpen={() => {
        setQuery("");
        load();
      }}
    >
      <Menu.Target>
        <UnstyledButton className={classes.branchTarget} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          {children}
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
        <TextInput
          size="xs"
          placeholder={t("Search branches")}
          leftSection={<IconSearch size={13} />}
          rightSection={loading ? <Loader size={12} /> : null}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => e.stopPropagation()}
          data-autofocus
          mb={4}
        />
        {!q && (
          <>
            <Menu.Item leftSection={<IconArrowDown size={14} />} onClick={() => act(t("Could not update"), () => gitPull(repo.path), t("Branch updated"))}>
              {t("Update (pull)")}
            </Menu.Item>
            <Menu.Item leftSection={<IconCloudDownload size={14} />} onClick={() => act(t("Could not fetch"), () => gitFetch(repo.path), t("Fetch done"))}>
              Fetch
            </Menu.Item>
            <Menu.Item leftSection={<IconPlus size={14} />} onClick={() => newBranch(null)}>
              {t("New branch…")}
            </Menu.Item>
          </>
        )}
        <div className={classes.branchList}>
          {!q && recent.length > 0 && (
            <>
              <Menu.Label>{t("Recent")}</Menu.Label>
              {recent.map((b) => row(b, "recent"))}
            </>
          )}
          {locals.length > 0 && <Menu.Label>{t("Local")}</Menu.Label>}
          {locals.map((b) => row(b, "local"))}
          {remotes.length > 0 && <Menu.Label>{t("Remote")}</Menu.Label>}
          {remotes.map((b) => row(b, "remote"))}
          {list && branches.length === 0 && (
            <Text size="xs" c="dimmed" p="sm">
              {t("No branch matches.")}
            </Text>
          )}
        </div>
      </Menu.Dropdown>
    </Menu>
  );
}

interface BranchRowProps {
  branch: BranchInfo;
  current: string | null;
  onCheckout: () => void;
  onNewFrom: () => void;
  onMerge: () => void;
  onRename: () => void;
  onDelete: () => void;
}

/** One branch with a hover submenu of what can be done with it. */
function BranchRow({ branch, current, onCheckout, onNewFrom, onMerge, onRename, onDelete }: BranchRowProps) {
  const { openTerminalAt } = useProjectContext();
  const held = branch.worktree;
  const icon = branch.current ? (
    <IconStarFilled size={13} color="var(--mantine-color-yellow-5)" />
  ) : branch.remote ? (
    <IconCloud size={14} color="var(--mantine-color-gray-5)" />
  ) : (
    <IconGitBranch size={14} color="var(--mantine-color-gray-5)" />
  );

  return (
    <Menu.Sub floatingStrategy="fixed" openDelay={80} closeDelay={120}>
      <Menu.Sub.Target>
        <Menu.Sub.Item leftSection={icon}>
          <Group gap={6} wrap="nowrap" justify="space-between">
            <Text size="xs" ff="monospace" truncate fw={branch.current ? 600 : 400}>
              {branch.name}
            </Text>
            <Group gap={4} wrap="nowrap">
              {held && (
                <Text size="xs" c="indigo.3">
                  worktree
                </Text>
              )}
              {branch.ahead > 0 && (
                <Text size="xs" c="teal.4">
                  ↑{branch.ahead}
                </Text>
              )}
              {branch.behind > 0 && (
                <Text size="xs" c="blue.4">
                  ↓{branch.behind}
                </Text>
              )}
            </Group>
          </Group>
        </Menu.Sub.Item>
      </Menu.Sub.Target>
      <Menu.Sub.Dropdown>
        {held && (
          <>
            <Menu.Label>{t("Checked out in another worktree")}</Menu.Label>
            <Menu.Item leftSection={<IconTerminal2 size={14} />} onClick={() => openTerminalAt(held)}>
              {t("Terminal in the worktree")}
            </Menu.Item>
            <Menu.Item leftSection={<IconCode size={14} />} onClick={() => openInEditor(held).catch((e) => notifyError(e))}>
              {t("Open worktree in editor")}
            </Menu.Item>
            <Menu.Divider />
          </>
        )}
        {!branch.current && !held && (
          <Menu.Item leftSection={<IconGitBranch size={14} />} onClick={onCheckout}>
            Checkout
          </Menu.Item>
        )}
        <Menu.Item leftSection={<IconPlus size={14} />} onClick={onNewFrom}>
          {t("New branch from “{branch}”…", { branch: branch.name })}
        </Menu.Item>
        {!branch.current && current && (
          <Menu.Item leftSection={<IconGitMerge size={14} />} onClick={onMerge}>
            {t("Merge “{branch}” into “{current}”", { branch: branch.name, current })}
          </Menu.Item>
        )}
        {!branch.remote && (
          <Menu.Item leftSection={<IconPencil size={14} />} onClick={onRename}>
            {t("Rename…")}
          </Menu.Item>
        )}
        {!branch.remote && !branch.current && !held && (
          <Menu.Item leftSection={<IconTrash size={14} />} color="red" onClick={onDelete}>
            {t("Delete")}
          </Menu.Item>
        )}
      </Menu.Sub.Dropdown>
    </Menu.Sub>
  );
}
