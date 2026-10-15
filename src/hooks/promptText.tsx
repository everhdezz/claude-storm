import { useState } from "react";
import { Button, Checkbox, Group, Stack, TextInput } from "@mantine/core";
import { modals } from "@mantine/modals";
import { t } from "../i18n";

interface PromptOptions {
  title: string;
  label: string;
  initial?: string;
  confirm?: string;
  /** Optional checkbox shown under the input (e.g. "Hacer checkout"). */
  checkbox?: { label: string; initial: boolean };
}

/** Asks for one line of text in a modal; resolves null when cancelled. */
export function promptText(options: PromptOptions): Promise<{ value: string; checked: boolean } | null> {
  return new Promise((resolve) => {
    const id = modals.open({
      title: options.title,
      centered: true,
      onClose: () => resolve(null),
      children: (
        <PromptForm
          options={options}
          onSubmit={(result) => {
            resolve(result);
            modals.close(id);
          }}
          onCancel={() => modals.close(id)}
        />
      ),
    });
  });
}

function PromptForm({
  options,
  onSubmit,
  onCancel,
}: {
  options: PromptOptions;
  onSubmit: (result: { value: string; checked: boolean }) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(options.initial ?? "");
  const [checked, setChecked] = useState(options.checkbox?.initial ?? false);
  const valid = value.trim().length > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit({ value: value.trim(), checked });
      }}
    >
      <Stack>
        <TextInput label={options.label} value={value} onChange={(e) => setValue(e.currentTarget.value)} data-autofocus />
        {options.checkbox && (
          <Checkbox label={options.checkbox.label} checked={checked} onChange={(e) => setChecked(e.currentTarget.checked)} />
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button type="submit" disabled={!valid}>
            {options.confirm ?? t("OK")}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
