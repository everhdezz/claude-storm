import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { closeTerminal, openTerminal, resizeTerminal, writeTerminal } from "../../api/terminals";
import { notifyError } from "../../hooks/notify";

interface XtermViewProps {
  projectId: string;
  cwd: string;
  visible: boolean;
  onTitle: (title: string) => void;
  onExit: () => void;
}

const THEME = {
  background: "#1e1f22",
  foreground: "#d4d4d4",
  cursor: "#d4d4d4",
  selectionBackground: "#2e436e",
};

/** One xterm.js instance bound to a backend PTY for its whole lifetime. */
export function XtermView({ projectId, cwd, visible, onTitle, onExit }: XtermViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const idRef = useRef<string | null>(null);
  const callbacks = useRef({ onTitle, onExit });
  callbacks.current = { onTitle, onExit };

  useEffect(() => {
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, monospace",
      fontSize: 12.5,
      cursorBlink: true,
      scrollback: 5000,
      theme: THEME,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current!);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    let disposed = false;

    openTerminal(projectId, cwd, term.cols, term.rows, (event) => {
      if (event.kind === "output") term.write(event.data);
      else callbacks.current.onExit();
    })
      .then((info) => {
        if (disposed) {
          closeTerminal(info.id);
          return;
        }
        idRef.current = info.id;
        callbacks.current.onTitle(info.title);
      })
      .catch((err) => notifyError(err, "No se pudo abrir la terminal"));

    const input = term.onData((data) => {
      if (idRef.current) writeTerminal(idRef.current, data).catch(() => undefined);
    });
    const title = term.onTitleChange((t) => t && callbacks.current.onTitle(t));
    const observer = new ResizeObserver(() => refit());
    observer.observe(host.current!);

    function refit() {
      if (!host.current || host.current.offsetParent === null) return;
      fit.fit();
      if (idRef.current) resizeTerminal(idRef.current, term.cols, term.rows).catch(() => undefined);
    }

    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      title.dispose();
      if (idRef.current) closeTerminal(idRef.current);
      term.dispose();
    };
  }, [projectId, cwd]);

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      fitRef.current?.fit();
      const term = termRef.current;
      if (term && idRef.current) resizeTerminal(idRef.current, term.cols, term.rows).catch(() => undefined);
      term?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  return <div ref={host} style={{ flex: 1, minHeight: 0, padding: "4px 0 0 10px", display: visible ? "block" : "none" }} />;
}
