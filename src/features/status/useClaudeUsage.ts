import { useCallback, useEffect, useState } from "react";
import { claudeUsage, claudeUsageCached, USAGE_UPDATED, type UsageSnapshot } from "../../api/usage";
import { useTauriEvent } from "../../hooks/useTauriEvent";

const REFRESH_MS = 10 * 60_000;
const STALE_MS = 60 * 60_000;

/** Plan usage of the project's account: cached first, refreshed every 10 minutes or on demand. */
export function useClaudeUsage(projectId: string, accountId: string | null) {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [, setTick] = useState(0);

  const refresh = useCallback(
    async function refresh(force: boolean) {
      setLoading(true);
      try {
        setSnapshot(await claudeUsage(projectId, force));
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    setSnapshot(null);
    if (!accountId) return;
    claudeUsageCached(projectId).then((cached) => cached && setSnapshot(cached));
    refresh(false);
    const timer = window.setInterval(() => refresh(false), REFRESH_MS);
    const clock = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(clock);
    };
  }, [refresh, accountId, projectId]);

  useTauriEvent<UsageSnapshot>(USAGE_UPDATED, (next) => {
    if (next.profileKey === accountId) setSnapshot(next);
  });

  const stale = snapshot ? Date.now() - new Date(snapshot.fetchedAt).getTime() > STALE_MS : false;
  return { snapshot, loading, stale, refresh };
}

/** Formats the time left until an ISO date as "2h 10m" / "3d 4h". */
export function timeUntil(iso: string | null): string | null {
  if (!iso) return null;
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (minutes <= 0) return "ya";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
