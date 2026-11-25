import { useRef, useState } from "react";
import { Center, Loader } from "@mantine/core";
import { WIKI_CHANGED, type WikiChanged } from "../../api/wiki";
import { useTauriEvent } from "../../hooks/useTauriEvent";
import { useProjectContext } from "../project/ProjectContext";
import { findWikiNode } from "./useWiki";
import { WikiEditor } from "./WikiEditor";

/** The wiki page of the active tab, in the Notion-like editor. */
export function WikiPane({ path }: { path: string }) {
  const { project, wiki } = useProjectContext();
  // Bumped when Claude rewrites the open page, so the editor reloads it.
  const [version, setVersion] = useState(0);
  // The editor keeps its document while the page is renamed or moved, so it is keyed by page, not path.
  const pageKey = useRef({ path, key: 0 });
  if (pageKey.current.path !== path) {
    const relocated = wiki.nodes !== null && findWikiNode(wiki.nodes, path) !== null && !findWikiNode(wiki.nodes, pageKey.current.path);
    pageKey.current = { path, key: relocated ? pageKey.current.key : pageKey.current.key + 1 };
  }

  useTauriEvent<WikiChanged>(WIKI_CHANGED, ({ projectId, paths }) => {
    if (projectId === project.id && paths.length === 1 && paths[0] === path) setVersion((v) => v + 1);
  });

  const node = wiki.nodes ? findWikiNode(wiki.nodes, path) : null;
  if (!node) {
    return (
      <Center style={{ flex: 1 }}>
        <Loader size="sm" />
      </Center>
    );
  }
  return (
    <WikiEditor
      key={`${pageKey.current.key}:${version}`}
      projectId={project.id}
      path={path}
      name={node.name}
      onRename={(name) => wiki.rename(path, name)}
    />
  );
}
