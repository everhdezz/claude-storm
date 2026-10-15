import pkg from "../package.json";
import { t } from "./i18n";

/** App version shown in the status bar and the welcome window. */
export const APP_VERSION = pkg.version;

/** Release channel label; stays "alpha" until the first stable cut. */
export function channelLabel(): string {
  return t("alpha");
}
