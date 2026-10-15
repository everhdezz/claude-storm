import { useState } from "react";
import { Button, Center, Loader, ScrollArea, Stack, Text, TextInput } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconSearch } from "@tabler/icons-react";
import { createProject, deleteProject, openProjectWindow, renameProject } from "../../api/projects";
import { notifyError } from "../../hooks/notify";
import type { ProjectSummary } from "../../types";
import { ProjectNameModal } from "./ProjectNameModal";
import { ProjectRow } from "./ProjectRow";
import { useListKeyboard } from "./useListKeyboard";
import { useProjects } from "./useProjects";
import classes from "./welcome.module.css";
import { t } from "../../i18n";

type Dialog = { kind: "create" } | { kind: "rename"; project: ProjectSummary } | null;

/** Searchable list of projects with create, rename and delete actions. */
export function ProjectsPane() {
  const { projects, loading } = useProjects();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const needle = query.trim().toLowerCase();
  const visible = projects.filter(
    (p) => p.name.toLowerCase().includes(needle) || (p.rootHint ?? "").toLowerCase().includes(needle),
  );

  async function open(project: ProjectSummary) {
    try {
      await openProjectWindow(project.id);
    } catch (err) {
      notifyError(err, t("Could not open the project"));
    }
  }

  useListKeyboard({ items: visible, selectedIndex, onSelectIndex: setSelectedIndex, onActivate: open });

  async function handleCreate(name: string) {
    try {
      const created = await createProject(name);
      await openProjectWindow(created.id);
    } catch (err) {
      notifyError(err);
    }
  }

  async function handleRename(name: string) {
    if (dialog?.kind !== "rename") return;
    try {
      await renameProject(dialog.project.id, name);
    } catch (err) {
      notifyError(err);
    }
  }

  function confirmDelete(project: ProjectSummary) {
    modals.openConfirmModal({
      title: t("Remove “{project}”", { project: project.name }),
      centered: true,
      children: (
        <Text size="sm">
          {t("Only the project entry in ClaudeStorm is removed. Repos and files on disk are not touched.")}
        </Text>
      ),
      labels: { confirm: t("Remove"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () => deleteProject(project.id).catch((err) => notifyError(err)),
    });
  }

  return (
    <>
      <div className={classes.toolbar}>
        <TextInput
          className={classes.search}
          placeholder={t("Search projects")}
          leftSection={<IconSearch size={18} />}
          value={query}
          autoFocus
          onChange={(e) => {
            setQuery(e.currentTarget.value);
            setSelectedIndex(0);
          }}
        />
        <Button variant="default" onClick={() => setDialog({ kind: "create" })}>
          {t("New project")}
        </Button>
      </div>

      <ScrollArea className={classes.list} type="auto">
        {loading ? (
          <Center py="xl">
            <Loader size="sm" />
          </Center>
        ) : visible.length === 0 ? (
          <Center py={80}>
            <Stack align="center" gap={4}>
              <Text fw={600}>{projects.length === 0 ? t("You have no projects yet") : t("No results")}</Text>
              <Text size="sm" c="dimmed">
                {projects.length === 0 ? t("Create one and add the repos you work with.") : t("Try another name.")}
              </Text>
            </Stack>
          </Center>
        ) : (
          <div role="listbox">
            {visible.map((p, index) => (
              <ProjectRow
                key={p.id}
                project={p}
                selected={index === selectedIndex}
                onSelect={() => setSelectedIndex(index)}
                onOpen={open}
                onRename={(project) => setDialog({ kind: "rename", project })}
                onDelete={confirmDelete}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      <ProjectNameModal
        opened={dialog !== null}
        title={dialog?.kind === "rename" ? t("Rename project") : t("New project")}
        submitLabel={dialog?.kind === "rename" ? t("Save") : t("Create and open")}
        initialName={dialog?.kind === "rename" ? dialog.project.name : ""}
        onClose={() => setDialog(null)}
        onSubmit={dialog?.kind === "rename" ? handleRename : handleCreate}
      />
    </>
  );
}
