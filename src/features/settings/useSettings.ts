import { useEffect, useState } from "react";
import { getSettings, SETTINGS_CHANGED } from "../../api/settings";
import { useTauriEvent } from "../../hooks/useTauriEvent";
import type { AppSettings } from "../../types";

const EMPTY: AppSettings = { accounts: [], catalog: [], catalogUpdatedAt: null, defaultModel: null, maxParallelSessions: 3 };

/** Global settings kept in sync across every window. */
export function useSettings(): AppSettings {
  const [settings, setSettings] = useState<AppSettings>(EMPTY);

  useEffect(() => {
    getSettings().then(setSettings).catch(() => setSettings(EMPTY));
  }, []);

  useTauriEvent<AppSettings>(SETTINGS_CHANGED, setSettings);
  return settings;
}
