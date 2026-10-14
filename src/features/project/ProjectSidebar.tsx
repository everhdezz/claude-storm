import { ScrollArea, SegmentedControl, Stack, Text } from "@mantine/core";
import { useState } from "react";
import { FrameworkIcon } from "../../components/FrameworkIcon";
import { GitBadge } from "../../components/GitBadge";
import { ProcessStatusDot } from "../processes/ProcessStatusDot";
import { useProjectContext } from "./ProjectContext";
import classes from "./project.module.css";

type SidebarTab = "repos" | "sessions";

/** Left column of a project window with the repo list and Claude sessions. */
export function ProjectSidebar() {
  const [tab, setTab] = useState<SidebarTab>("repos");
  return (
    <aside className={classes.sidebar}>
      <div className={classes.sidebarHeader}>
        <SegmentedControl
          fullWidth
          size="xs"
          value={tab}
          onChange={(v) => setTab(v as SidebarTab)}
          data={[
            { value: "repos", label: "Repos" },
            { value: "sessions", label: "Sesiones" },
          ]}
        />
      </div>
      <ScrollArea style={{ flex: 1 }} type="auto">
        {tab === "repos" ? <RepoList /> : <Text size="sm" c="dimmed" p="md">Próximamente</Text>}
      </ScrollArea>
    </aside>
  );
}

/** Compact list of the project's repos; clicking scrolls to the card. */
function RepoList() {
  const { project, gitStatuses, processes } = useProjectContext();
  const procs = Object.values(processes);
  if (project.repos.length === 0) {
    return (
      <Text size="sm" c="dimmed" p="md">
        Sin repos todavía.
      </Text>
    );
  }
  return (
    <Stack gap={2} p={8}>
      {project.repos.map((repo) => (
        <div
          key={repo.id}
          className={classes.repoItem}
          onClick={() => document.getElementById(`repo-${repo.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
        >
          <FrameworkIcon framework={repo.framework} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <Text size="sm" fw={500} truncate>
              {repo.name}
            </Text>
            <GitBadge status={gitStatuses[repo.id]} compact />
          </div>
          <ProcessStatusDot processes={procs.filter((p) => p.repoId === repo.id)} />
        </div>
      ))}
    </Stack>
  );
}
