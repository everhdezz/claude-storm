import { useCallback, useEffect, useState } from "react";
import { forgetProcess, listProcesses, PROCESS_STATUS } from "../../api/processes";
import { useTauriEvent } from "../../hooks/useTauriEvent";
import type { ProcessInfo } from "../../types";

/** Keeps the live list of processes for a project, keyed by process id. */
export function useProcesses(projectId: string) {
  const [processes, setProcesses] = useState<Record<string, ProcessInfo>>({});

  useEffect(() => {
    listProcesses(projectId).then((list) => setProcesses(Object.fromEntries(list.map((p) => [p.id, p]))));
  }, [projectId]);

  useTauriEvent<ProcessInfo>(PROCESS_STATUS, (info) => {
    if (info.projectId === projectId) setProcesses((prev) => ({ ...prev, [info.id]: info }));
  });

  const forget = useCallback(async function forget(id: string) {
    await forgetProcess(id);
    setProcesses((prev) => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  return { processes, forget };
}
