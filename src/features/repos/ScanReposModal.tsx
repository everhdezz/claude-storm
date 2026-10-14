import { useState } from "react";
import { Button, Center, Checkbox, Group, Loader, Modal, ScrollArea, Stack, Text } from "@mantine/core";
import { IconFolderSearch } from "@tabler/icons-react";
import { addRepos, scanRepos } from "../../api/repos";
import { FrameworkBadge } from "../../components/FrameworkIcon";
import { notifyError, notifySuccess } from "../../hooks/notify";
import type { RepoCandidate } from "../../types";
import { pickFolder } from "./useAddRepos";

interface ScanReposModalProps {
  projectId: string;
  opened: boolean;
  onClose: () => void;
}

/** Scans a parent folder for git repos and lets the user tick which ones to add. */
export function ScanReposModal({ projectId, opened, onClose }: ScanReposModalProps) {
  const [root, setRoot] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<RepoCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);

  async function chooseRoot() {
    const path = await pickFolder("Carpeta padre a escanear");
    if (!path) return;
    setRoot(path);
    setScanning(true);
    try {
      const found = await scanRepos(projectId, path);
      setCandidates(found);
      setSelected(new Set(found.filter((c) => !c.alreadyAdded).map((c) => c.path)));
    } catch (err) {
      notifyError(err, "No se pudo escanear");
    } finally {
      setScanning(false);
    }
  }

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function close() {
    setRoot(null);
    setCandidates([]);
    setSelected(new Set());
    onClose();
  }

  async function submit() {
    setSaving(true);
    try {
      const added = await addRepos(projectId, [...selected]);
      notifySuccess(`${added.length} repo(s) agregados`);
      close();
    } catch (err) {
      notifyError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal opened={opened} onClose={close} title="Escanear carpeta" size="lg" centered>
      <Stack>
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" c={root ? undefined : "dimmed"} ff={root ? "monospace" : undefined} truncate>
            {root ?? "Elige una carpeta que contenga varios repos git"}
          </Text>
          <Button variant="default" leftSection={<IconFolderSearch size={16} />} onClick={chooseRoot}>
            {root ? "Cambiar" : "Elegir carpeta"}
          </Button>
        </Group>
        {scanning ? (
          <Center py="lg">
            <Loader size="sm" />
          </Center>
        ) : root && candidates.length === 0 ? (
          <Text size="sm" c="dimmed">No se encontraron repos git (hasta 3 niveles de profundidad).</Text>
        ) : (
          <ScrollArea.Autosize mah={360}>
            <Stack gap="xs">
              {candidates.map((c) => (
                <Checkbox
                  key={c.path}
                  checked={c.alreadyAdded || selected.has(c.path)}
                  disabled={c.alreadyAdded}
                  onChange={() => toggle(c.path)}
                  label={
                    <Group gap="xs" wrap="nowrap">
                      <Text size="sm" fw={500}>
                        {c.name}
                      </Text>
                      <FrameworkBadge framework={c.detection.framework} />
                      {c.alreadyAdded && <Text size="xs" c="dimmed">ya agregado</Text>}
                    </Group>
                  }
                  description={c.path}
                />
              ))}
            </Stack>
          </ScrollArea.Autosize>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={close}>
            Cancelar
          </Button>
          <Button disabled={selected.size === 0} loading={saving} onClick={submit}>
            Agregar {selected.size || ""}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
