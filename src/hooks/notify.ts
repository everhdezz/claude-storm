import { notifications } from "@mantine/notifications";
import { errorMessage } from "../api/tauri";

/** Shows an error toast for a failed operation. */
export function notifyError(err: unknown, title = "Something went wrong"): void {
  notifications.show({ color: "red", title, message: errorMessage(err), autoClose: 7000 });
}

/** Shows a success toast. */
export function notifySuccess(message: string): void {
  notifications.show({ color: "teal", message, autoClose: 3000 });
}
