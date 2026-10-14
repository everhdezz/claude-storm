import { Badge, ThemeIcon, Tooltip } from "@mantine/core";
import {
  IconBrandLaravel,
  IconBrandNextjs,
  IconBrandNodejs,
  IconBrandReact,
  IconBrandVite,
  IconDeviceMobile,
  IconFolder,
  type Icon,
} from "@tabler/icons-react";
import type { Framework } from "../types";

interface FrameworkMeta {
  label: string;
  color: string;
  icon: Icon;
}

const META: Record<Framework, FrameworkMeta> = {
  next: { label: "Next.js", color: "gray", icon: IconBrandNextjs },
  vite: { label: "Vite", color: "violet", icon: IconBrandVite },
  react: { label: "React", color: "cyan", icon: IconBrandReact },
  expo: { label: "Expo", color: "indigo", icon: IconDeviceMobile },
  laravel: { label: "Laravel", color: "red", icon: IconBrandLaravel },
  node: { label: "Node", color: "green", icon: IconBrandNodejs },
  generic: { label: "Genérico", color: "dark", icon: IconFolder },
};

/** Returns display metadata for a framework. */
export function frameworkMeta(framework: Framework): FrameworkMeta {
  return META[framework] ?? META.generic;
}

/** Small colored icon representing a framework. */
export function FrameworkIcon({ framework, size = 26 }: { framework: Framework; size?: number }) {
  const meta = frameworkMeta(framework);
  const Icon = meta.icon;
  return (
    <Tooltip label={meta.label} openDelay={400}>
      <ThemeIcon variant="light" color={meta.color} size={size} radius="sm">
        <Icon size={size * 0.65} stroke={1.7} />
      </ThemeIcon>
    </Tooltip>
  );
}

/** Text badge with the framework name. */
export function FrameworkBadge({ framework }: { framework: Framework }) {
  const meta = frameworkMeta(framework);
  return (
    <Badge variant="light" color={meta.color} size="sm" radius="sm">
      {meta.label}
    </Badge>
  );
}
