import { useCallback, useEffect, useRef, useState } from "react";
import { gitStatus } from "../../api/repos";
import type { GitStatus, Repo } from "../../types";

const POLL_MS = 30_000;

export type GitStatusMap = Record<string, GitStatus | undefined>;

/** Polls git status for every repo every 30s, on window focus, and on demand. */
export function useGitStatuses(repos: Repo[]) {
  const [statuses, setStatuses] = useState<GitStatusMap>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const reposRef = useRef(repos);
  reposRef.current = repos;
  const repoKey = repos.map((r) => `${r.id}:${r.path}`).join("|");

  const refresh = useCallback(async function refresh(repoId?: string) {
    const targets = reposRef.current.filter((r) => !repoId || r.id === repoId);
    await Promise.all(
      targets.map(async (repo) => {
        try {
          const status = await gitStatus(repo.path);
          setStatuses((prev) => ({ ...prev, [repo.id]: status }));
          setErrors((prev) => {
            const { [repo.id]: _removed, ...rest } = prev;
            return rest;
          });
        } catch (err) {
          setErrors((prev) => ({ ...prev, [repo.id]: err instanceof Error ? err.message : String(err) }));
        }
      }),
    );
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => refresh(), POLL_MS);
    window.addEventListener("focus", onFocus);
    function onFocus() {
      refresh();
    }
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [repoKey, refresh]);

  return { statuses, errors, refresh };
}
