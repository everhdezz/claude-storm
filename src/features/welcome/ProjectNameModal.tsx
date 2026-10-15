import { useEffect } from "react";
import { Button, Group, Modal, TextInput } from "@mantine/core";
import { useForm } from "react-hook-form";
import { t } from "../../i18n";

interface ProjectNameModalProps {
  opened: boolean;
  title: string;
  submitLabel: string;
  initialName?: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}

interface FormValues {
  name: string;
}

/** Modal with a single validated name field, used for create and rename. */
export function ProjectNameModal({ opened, title, submitLabel, initialName = "", onClose, onSubmit }: ProjectNameModalProps) {
  const { register, handleSubmit, reset, formState } = useForm<FormValues>({ defaultValues: { name: initialName } });

  useEffect(() => {
    if (opened) reset({ name: initialName });
  }, [opened, initialName, reset]);

  async function submit(values: FormValues) {
    await onSubmit(values.name.trim());
    onClose();
  }

  return (
    <Modal opened={opened} onClose={onClose} title={title} centered>
      <form onSubmit={handleSubmit(submit)}>
        <TextInput
          label={t("Name")}
          placeholder={t("My project")}
          data-autofocus
          error={formState.errors.name?.message}
          {...register("name", {
            validate: (v) => v.trim().length > 0 || t("The name is required"),
            maxLength: { value: 80, message: t("80 characters max") },
          })}
        />
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button type="submit" loading={formState.isSubmitting}>
            {submitLabel}
          </Button>
        </Group>
      </form>
    </Modal>
  );
}
