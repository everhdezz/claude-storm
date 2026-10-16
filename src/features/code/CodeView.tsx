import { useEffect, useRef, useState } from "react";
import { ActionIcon, Center, Stack, Text, Tooltip } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconCode, IconDeviceFloppy, IconRefresh, IconX } from "@tabler/icons-react";
import { basicSetup } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { repoReadFile, repoWriteFile } from "../../api/files";
import { FileIcon, fileKind } from "../../components/FileIcon";
import { Island } from "../../components/ide/Island";
import { notifyError } from "../../hooks/notify";
import { t } from "../../i18n";
import { useProjectContext } from "../project/ProjectContext";
import classes from "./code.module.css";

/** A file of a repo open in the editor. */
export interface CodeFile {
  repoId: string;
  path: string;
}

/** What the code editor remembers per project window. */
export interface CodeUiState {
  tabs?: CodeFile[];
  active?: number;
}

const keyOf = (f: CodeFile) => `${f.repoId}:${f.path}`;
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Loaded text of a tab: the editor state (keeps undo history) and the text last saved to disk. */
interface Buffer {
  state: EditorState;
  saved: string;
}

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "12.5px", backgroundColor: "transparent" },
  ".cm-scroller": { fontFamily: "var(--mantine-font-family-monospace)", lineHeight: "1.55" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none" },
});

/** Code editor of the main area: tabs of repo files opened from the Projects tree. */
export function CodeView({ hidden, request }: { hidden: boolean; request: (CodeFile & { seq: number }) | null }) {
  const { project, ui, setActiveFile } = useProjectContext();
  const saved = ui.initial.code ?? {};
  const [tabs, setTabs] = useState<CodeFile[]>(saved.tabs ?? []);
  const [active, setActive] = useState<number>(Math.min(saved.active ?? 0, Math.max(0, (saved.tabs?.length ?? 1) - 1)));
  const [dirty, setDirty] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const buffers = useRef(new Map<string, Buffer>());
  const language = useRef(new Compartment());
  const current = tabs[active] ?? null;
  const currentRef = useRef(current);
  currentRef.current = current;

  const reposById = new Map(project.repos.map((r) => [r.id, r]));

  // Requests from the Projects tree open (or focus) a tab.
  useEffect(() => {
    if (!request) return;
    const file = { repoId: request.repoId, path: request.path };
    setTabs((prev) => {
      const i = prev.findIndex((f) => keyOf(f) === keyOf(file));
      if (i >= 0) {
        setActive(i);
        return prev;
      }
      setActive(prev.length);
      return [...prev, file];
    });
  }, [request]);

  useEffect(() => {
    ui.save({ code: { tabs, active } });
  }, [tabs, active, ui]);

  useEffect(() => {
    setActiveFile(current);
  }, [current?.repoId, current?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  function save() {
    const file = currentRef.current;
    const editor = view.current;
    if (!file || !editor) return true;
    const key = keyOf(file);
    const text = editor.state.doc.toString();
    repoWriteFile(project.id, file.repoId, file.path, text)
      .then(() => {
        const buffer = buffers.current.get(key);
        if (buffer) buffer.saved = text;
        setDirty((prev) => prev.filter((k) => k !== key));
      })
      .catch((err) => notifyError(err, t("Could not save the file")));
    return true;
  }
  const saveRef = useRef(save);
  saveRef.current = save;

  function newState(doc: string, key: string): EditorState {
    return EditorState.create({
      doc,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab, { key: "Mod-s", preventDefault: true, run: () => saveRef.current() }]),
        oneDark,
        theme,
        language.current.of([]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const buffer = buffers.current.get(key);
          if (!buffer) return;
          buffer.state = update.state;
          const isDirty = update.state.doc.toString() !== buffer.saved;
          setDirty((prev) => (isDirty === prev.includes(key) ? prev : isDirty ? [...prev, key] : prev.filter((k) => k !== key)));
        }),
      ],
    });
  }

  /** Shows a tab's buffer in the editor, loading it from disk the first time. */
  async function show(file: CodeFile, reload = false) {
    const key = keyOf(file);
    let buffer = reload ? undefined : buffers.current.get(key);
    setError(null);
    if (!buffer) {
      try {
        const text = await repoReadFile(project.id, file.repoId, file.path);
        buffer = { state: newState(text, key), saved: text };
        buffers.current.set(key, buffer);
        setDirty((prev) => prev.filter((k) => k !== key));
      } catch (err) {
        if (currentRef.current && keyOf(currentRef.current) === key) setError(String(err));
        return;
      }
    }
    if (!currentRef.current || keyOf(currentRef.current) !== key) return;
    if (!view.current) view.current = new EditorView({ state: buffer.state, parent: host.current! });
    else view.current.setState(buffer.state);
    const lang = LanguageDescription.matchFilename(languages, baseName(file.path));
    if (lang) {
      lang.load().then((support) => {
        if (currentRef.current && keyOf(currentRef.current) === key) view.current?.dispatch({ effects: language.current.reconfigure(support) });
      });
    }
    if (!hidden) view.current.focus();
  }

  useEffect(() => {
    if (current) show(current);
  }, [current?.repoId, current?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => view.current?.destroy(), []);

  function close(index: number) {
    const file = tabs[index]!;
    const key = keyOf(file);
    const doClose = () => {
      buffers.current.delete(key);
      setDirty((prev) => prev.filter((k) => k !== key));
      setTabs((prev) => prev.filter((_, i) => i !== index));
      setActive((a) => (index < a || a >= tabs.length - 1 ? Math.max(0, a - 1) : a));
    };
    if (!dirty.includes(key)) return doClose();
    modals.openConfirmModal({
      title: t("Discard changes?"),
      centered: true,
      children: <Text size="sm">{t("“{name}” has unsaved changes.", { name: baseName(file.path) })}</Text>,
      labels: { confirm: t("Discard"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: doClose,
    });
  }

  const currentDirty = current ? dirty.includes(keyOf(current)) : false;

  return (
    <Island
      style={{ flex: 1, display: hidden ? "none" : undefined }}
      title={
        current ? (
          <Text size="xs" c="dimmed" truncate>
            {reposById.get(current.repoId)?.name ?? "?"} / {current.path}
          </Text>
        ) : (
          t("Code")
        )
      }
      actions={
        current && (
          <>
            <Tooltip label={t("Reload from disk")}>
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => show(current, true)} aria-label={t("Reload from disk")}>
                <IconRefresh size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("Save (⌘S)")}>
              <ActionIcon variant="subtle" color="gray" size="sm" disabled={!currentDirty} onClick={save} aria-label={t("Save (⌘S)")}>
                <IconDeviceFloppy size={14} />
              </ActionIcon>
            </Tooltip>
          </>
        )
      }
    >
      {tabs.length > 0 && (
        <div className={classes.tabs}>
          {tabs.map((file, i) => {
            const key = keyOf(file);
            return (
              <div
                key={key}
                className={classes.tab}
                data-active={i === active || undefined}
                style={i === active ? { borderBottomColor: fileKind(baseName(file.path)).color } : undefined}
                title={`${reposById.get(file.repoId)?.name ?? "?"} / ${file.path}`}
                onClick={() => setActive(i)}
                onAuxClick={(e) => e.button === 1 && close(i)}
              >
                <FileIcon name={baseName(file.path)} size={14} />
                <span>{baseName(file.path)}</span>
                {dirty.includes(key) && <span className={classes.dot} />}
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="xs"
                  className={classes.close}
                  onClick={(e) => {
                    e.stopPropagation();
                    close(i);
                  }}
                  aria-label={t("Close")}
                >
                  <IconX size={11} />
                </ActionIcon>
              </div>
            );
          })}
        </div>
      )}
      <div ref={host} className={classes.editor} style={{ display: current && !error ? undefined : "none" }} />
      {current && error && (
        <Center style={{ flex: 1 }}>
          <Text size="sm" c="dimmed">
            {error}
          </Text>
        </Center>
      )}
      {!current && (
        <Center style={{ flex: 1 }}>
          <Stack align="center" gap={6}>
            <IconCode size={40} stroke={1.2} color="var(--mantine-color-dimmed)" />
            <Text size="sm" c="dimmed">
              {t("Open a file from the Projects tree.")}
            </Text>
          </Stack>
        </Center>
      )}
    </Island>
  );
}
