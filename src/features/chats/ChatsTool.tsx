import { Stack, Text } from "@mantine/core";
import { IconMessages } from "@tabler/icons-react";
import { Island } from "../../components/ide/Island";

/** Left tool window that will list the project's parallel Claude sessions. */
export function ChatsTool({ style }: { style?: React.CSSProperties }) {
  return (
    <Island title="Chats" style={style}>
      <Stack align="center" gap={6} p="lg" mt="lg">
        <IconMessages size={28} stroke={1.4} color="var(--mantine-color-dark-2)" />
        <Text size="sm" fw={500}>
          Sesiones de Claude
        </Text>
        <Text size="xs" c="dimmed" ta="center">
          Aquí aparecerán las sesiones paralelas del proyecto. Es la siguiente fase en construirse.
        </Text>
      </Stack>
    </Island>
  );
}
