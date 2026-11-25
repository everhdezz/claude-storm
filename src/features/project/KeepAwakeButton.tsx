import { useEffect, useState } from "react";
import { ActionIcon, Tooltip } from "@mantine/core";
import { IconCoffee, IconCoffeeOff } from "@tabler/icons-react";
import { KEEP_AWAKE_CHANGED, keepAwakeState, setKeepAwake, type KeepAwakeState } from "../../api/keepAwake";
import { notifyError } from "../../hooks/notify";
import { useTauriEvent } from "../../hooks/useTauriEvent";
import { t } from "../../i18n";

/** Title bar toggle that keeps the screen awake (like `caffeinate -d`); hidden where the OS has no such tool. */
export function KeepAwakeButton() {
  const [state, setState] = useState<KeepAwakeState | null>(null);

  useEffect(() => {
    keepAwakeState().then(setState).catch(() => setState(null));
  }, []);
  useTauriEvent<KeepAwakeState>(KEEP_AWAKE_CHANGED, setState);

  if (!state?.supported) return null;

  const label = state.active ? t("Screen stays awake · click to let it sleep") : t("Keep the screen awake");
  return (
    <Tooltip label={label}>
      <ActionIcon
        variant={state.active ? "light" : "subtle"}
        color={state.active ? "orange" : "gray"}
        onClick={() => setKeepAwake(!state.active).then(setState).catch((e) => notifyError(e))}
        aria-label={label}
        aria-pressed={state.active}
      >
        {state.active ? <IconCoffee size={18} stroke={1.6} /> : <IconCoffeeOff size={18} stroke={1.6} />}
      </ActionIcon>
    </Tooltip>
  );
}
