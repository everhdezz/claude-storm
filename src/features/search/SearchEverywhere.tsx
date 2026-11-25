import { useEffect, useRef, useState } from "react";
import { Chip, Group, Loader, Modal, ScrollArea, SegmentedControl, Text, TextInput, Tooltip, UnstyledButton } from "@mantine/core";
import { IconLetterCase, IconSearch } from "@tabler/icons-react";
import { type NameHit, type TextHit, searchFileNames, searchInFiles } from "../../api/files";
import { FileIcon } from "../../components/FileIcon";
import { t } from "../../i18n";
import { useProjectContext } from "../project/ProjectContext";
import classes from "./search.module.css";

export type SearchMode = "files" | "text";

/** What the search remembers per project window. */
export interface SearchUiState {
  /** Repos to search; empty means all of them. */
  repoIds?: string[];
  caseSensitive?: boolean;
}

interface SearchEverywhereProps {
  /** Mode it opens in; null keeps it closed. */
  opened: SearchMode | null;
  onClose: () => void;
}

/** WebStorm-like search: file names (double Shift, ⌘⇧O) or text in files (⌘⇧F), in the picked repos. */
export function SearchEverywhere({ opened, onClose }: SearchEverywhereProps) {
  const { project, ui, openFile } = useProjectContext();
  const saved = ui.initial.search ?? {};
  const [mode, setMode] = useState<SearchMode>("files");
  const [query, setQuery] = useState("");
  const [repoIds, setRepoIds] = useState<string[]>((saved.repoIds ?? []).filter((id) => project.repos.some((r) => r.id === id)));
  const [caseSensitive, setCaseSensitive] = useState(saved.caseSensitive ?? false);
  const [names, setNames] = useState<NameHit[]>([]);
  const [lines, setLines] = useState<TextHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const seq = useRef(0);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (opened) {
      setMode(opened);
      setSelected(0);
    }
  }, [opened]);

  useEffect(() => {
    ui.save({ search: { repoIds, caseSensitive } });
  }, [repoIds, caseSensitive, ui]);

  // Searches as you type; answers to older queries are dropped.
  useEffect(() => {
    if (!opened) return;
    const q = query.trim();
    const id = ++seq.current;
    if (!q || (mode === "text" && q.length < 2)) {
      setNames([]);
      setLines([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(
      () => {
        const done = () => id === seq.current && setLoading(false);
        if (mode === "files") {
          searchFileNames(project.id, repoIds, q)
            .then((hits) => id === seq.current && (setNames(hits), setSelected(0)))
            .catch(() => id === seq.current && setNames([]))
            .finally(done);
        } else {
          searchInFiles(project.id, repoIds, query, caseSensitive)
            .then((hits) => id === seq.current && (setLines(hits), setSelected(0)))
            .catch(() => id === seq.current && setLines([]))
            .finally(done);
        }
      },
      mode === "files" ? 60 : 250,
    );
    return () => window.clearTimeout(timer);
  }, [query, mode, repoIds, caseSensitive, opened, project.id]);

  const count = mode === "files" ? names.length : lines.length;

  useEffect(() => {
    list.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  function choose(index: number) {
    if (mode === "files") {
      const hit = names[index];
      if (hit) openFile(hit.repoId, hit.path);
    } else {
      const hit = lines[index];
      if (hit) openFile(hit.repoId, hit.path, hit.line);
    }
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, count - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(selected);
    } else if (e.key === "Tab") {
      // Tab switches between file names and text, as in WebStorm.
      e.preventDefault();
      setMode((m) => (m === "files" ? "text" : "files"));
    }
  }

  const repoName = (id: string) => project.repos.find((r) => r.id === id)?.name ?? "?";
  const multiRepo = project.repos.length > 1;

  return (
    <Modal opened={opened !== null} onClose={onClose} withCloseButton={false} size={760} yOffset="10vh" padding={0} radius="md">
      <div className={classes.head}>
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <SegmentedControl
            size="xs"
            value={mode}
            onChange={(v) => setMode(v as SearchMode)}
            data={[
              { value: "files", label: t("Files") },
              { value: "text", label: t("Text in files") },
            ]}
          />
          {mode === "text" && (
            <Tooltip label={t("Match case")}>
              <UnstyledButton className={classes.toggle} data-on={caseSensitive || undefined} onClick={() => setCaseSensitive((v) => !v)} aria-pressed={caseSensitive} aria-label={t("Match case")}>
                <IconLetterCase size={16} />
              </UnstyledButton>
            </Tooltip>
          )}
        </Group>
        {multiRepo && (
          <Group gap={6} mt={8} wrap="wrap">
            <Chip size="xs" checked={repoIds.length === 0} onChange={() => setRepoIds([])}>
              {t("All repos")}
            </Chip>
            {project.repos.map((r) => (
              <Chip
                key={r.id}
                size="xs"
                checked={repoIds.includes(r.id)}
                onChange={(on) => setRepoIds((prev) => (on ? [...prev, r.id] : prev.filter((id) => id !== r.id)))}
              >
                {r.name}
              </Chip>
            ))}
          </Group>
        )}
        <TextInput
          mt={10}
          data-autofocus
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          leftSection={loading ? <Loader size={14} /> : <IconSearch size={15} />}
          placeholder={mode === "files" ? t("File name (letters in order, e.g. usrctl)") : t("Text to find in the files")}
        />
      </div>
      <ScrollArea.Autosize mah="55vh" type="auto" viewportRef={list}>
        {count === 0 ? (
          <Text size="xs" c="dimmed" ta="center" p="md">
            {query.trim() && !loading ? t("Nothing found.") : mode === "files" ? t("Tab switches to text search.") : t("Tab switches to file names.")}
          </Text>
        ) : mode === "files" ? (
          names.map((hit, i) => {
            const slash = hit.path.lastIndexOf("/");
            return (
              <div key={`${hit.repoId}:${hit.path}`} data-index={i} className={classes.row} data-selected={i === selected || undefined} onMouseMove={() => setSelected(i)} onClick={() => choose(i)}>
                <FileIcon name={hit.path.slice(slash + 1)} size={15} />
                <span className={classes.name}>
                  <Highlighted text={hit.path} positions={hit.positions} from={slash + 1} />
                </span>
                <span className={classes.where}>
                  {multiRepo ? `${repoName(hit.repoId)} / ` : ""}
                  <Highlighted text={hit.path} positions={hit.positions} from={0} to={Math.max(slash, 0)} />
                </span>
              </div>
            );
          })
        ) : (
          lines.map((hit, i) => {
            const name = hit.path.slice(hit.path.lastIndexOf("/") + 1);
            return (
              <div key={`${hit.repoId}:${hit.path}:${hit.line}`} data-index={i} className={classes.row} data-selected={i === selected || undefined} onMouseMove={() => setSelected(i)} onClick={() => choose(i)}>
                <FileIcon name={name} size={15} />
                <span className={classes.code}>
                  <Match text={hit.text.trim()} query={query} caseSensitive={caseSensitive} />
                </span>
                <span className={classes.where} title={`${repoName(hit.repoId)} / ${hit.path}:${hit.line}`}>
                  {name}:{hit.line}
                </span>
              </div>
            );
          })
        )}
      </ScrollArea.Autosize>
      {mode === "text" && lines.length >= 500 && (
        <Text size="xs" c="dimmed" px="md" py={6}>
          {t("Showing the first 500 matches; refine the search to see the rest.")}
        </Text>
      )}
    </Modal>
  );
}

/** `text[from..to]` with the fuzzy-matched characters in bold. */
function Highlighted({ text, positions, from, to = text.length }: { text: string; positions: number[]; from: number; to?: number }) {
  const chars = Array.from(text);
  const marked = new Set(positions);
  const parts: React.ReactNode[] = [];
  for (let i = from; i < to; i++) parts.push(marked.has(i) ? <b key={i}>{chars[i]}</b> : chars[i]);
  return <>{parts}</>;
}

/** A line with every occurrence of `query` marked. */
function Match({ text, query, caseSensitive }: { text: string; query: string; caseSensitive: boolean }) {
  if (!query) return <>{text}</>;
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (let i = hay.indexOf(needle); i >= 0 && needle; i = hay.indexOf(needle, i + needle.length)) {
    parts.push(text.slice(at, i), <mark key={i}>{text.slice(i, i + needle.length)}</mark>);
    at = i + needle.length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}
