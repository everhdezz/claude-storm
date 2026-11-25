import { useEffect, useState } from "react";
import { Button, Center, Group, Loader, Modal, Stack, Text } from "@mantine/core";
import { IconFileOff, IconFolderOpen } from "@tabler/icons-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { attachmentBytes, attachmentPath, type AttachmentRef } from "../../api/sessions";
import { notifyError } from "../../hooks/notify";
import { t } from "../../i18n";
import { CopyablePre } from "./CopyablePre";
import classes from "./sessions.module.css";

const IMAGE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  heic: "image/heic",
  tif: "image/tiff",
  tiff: "image/tiff",
};

/** Largest text shown; longer files are cut. */
const MAX_TEXT = 400_000;

type Preview =
  | { kind: "loading" }
  | { kind: "image" | "pdf"; url: string }
  | { kind: "text"; text: string; cut: boolean }
  | { kind: "none"; reason: string };

/** Name shown for an attachment. */
export function attachmentName(ref: AttachmentRef): string {
  return "path" in ref ? (ref.path.split(/[\\/]/).pop() ?? ref.path) : ref.name;
}

/** Shows what an attachment contains: images, PDFs and text files; anything else can be opened in Finder. */
export function AttachmentViewer({ attachment, onClose }: { attachment: AttachmentRef | null; onClose: () => void }) {
  const [preview, setPreview] = useState<Preview>({ kind: "loading" });
  const name = attachment ? attachmentName(attachment) : "";

  useEffect(() => {
    if (!attachment) return;
    let url: string | null = null;
    let cancelled = false;
    setPreview({ kind: "loading" });
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    attachmentBytes(attachment)
      .then((buffer) => {
        if (cancelled) return;
        const mime = IMAGE[ext] ?? (ext === "pdf" ? "application/pdf" : null);
        if (mime) {
          url = URL.createObjectURL(new Blob([buffer], { type: mime }));
          setPreview({ kind: ext === "pdf" ? "pdf" : "image", url });
          return;
        }
        const bytes = new Uint8Array(buffer);
        // NUL bytes in the first few KB: a binary file (zip, docx, xlsx…).
        if (bytes.subarray(0, 8000).includes(0)) {
          setPreview({ kind: "none", reason: t("This type of file cannot be previewed.") });
          return;
        }
        const text = new TextDecoder("utf-8").decode(bytes.subarray(0, MAX_TEXT));
        setPreview({ kind: "text", text, cut: bytes.length > MAX_TEXT });
      })
      .catch((err: Error) => !cancelled && setPreview({ kind: "none", reason: err.message }));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [attachment, name]);

  async function reveal() {
    if (!attachment) return;
    try {
      await revealItemInDir(await attachmentPath(attachment));
    } catch (err) {
      notifyError(err, t("Could not show the file"));
    }
  }

  return (
    <Modal
      opened={attachment !== null}
      onClose={onClose}
      size="80%"
      centered
      title={
        <Text fw={600} truncate maw="60vw">
          {name}
        </Text>
      }
    >
      <Stack gap="sm">
        <div className={classes.attachmentPreview}>
          {preview.kind === "loading" && (
            <Center py="xl">
              <Loader size="sm" />
            </Center>
          )}
          {preview.kind === "image" && <img src={preview.url} alt={name} className={classes.attachmentImage} />}
          {preview.kind === "pdf" && <iframe src={preview.url} title={name} className={classes.attachmentPdf} />}
          {preview.kind === "text" && (
            <>
              <CopyablePre className={`${classes.code} selectable`} style={{ maxHeight: "65vh" }}>
                {preview.text}
              </CopyablePre>
              {preview.cut && (
                <Text size="xs" c="dimmed" mt={4}>
                  {t("The file is long; only its beginning is shown.")}
                </Text>
              )}
            </>
          )}
          {preview.kind === "none" && (
            <Stack align="center" gap={6} py="xl">
              <IconFileOff size={28} color="var(--mantine-color-dimmed)" />
              <Text size="sm" c="dimmed" ta="center">
                {preview.reason}
              </Text>
            </Stack>
          )}
        </div>
        <Group justify="flex-end">
          <Button size="xs" variant="default" leftSection={<IconFolderOpen size={14} />} onClick={reveal}>
            {t("Show in Finder")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
