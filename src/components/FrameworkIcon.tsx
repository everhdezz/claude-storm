import { Badge, ThemeIcon, Tooltip } from "@mantine/core";
import {
  IconBolt,
  IconBrandAngular,
  IconBrandAstro,
  IconBrandCSharp,
  IconBrandDeno,
  IconBrandDjango,
  IconBrandFlutter,
  IconBrandGatsby,
  IconBrandGolang,
  IconBrandLaravel,
  IconBrandNextjs,
  IconBrandNodejs,
  IconBrandNuxt,
  IconBrandPhp,
  IconBrandPython,
  IconBrandReact,
  IconBrandRust,
  IconBrandSolidjs,
  IconBrandSvelte,
  IconBrandSymfony,
  IconBrandVite,
  IconBrandVue,
  IconCoffee,
  IconDeviceGamepad2,
  IconDeviceMobile,
  IconDiamond,
  IconFlame,
  IconFlask,
  IconFolder,
  IconLeaf,
  IconServer2,
  type Icon,
} from "@tabler/icons-react";
import type { Framework } from "../types";
import { t } from "../i18n";

interface FrameworkMeta {
  label: string;
  color: string;
  icon: Icon;
}

const META: Record<Framework, FrameworkMeta> = {
  next: { label: "Next.js", color: "gray", icon: IconBrandNextjs },
  nuxt: { label: "Nuxt", color: "teal", icon: IconBrandNuxt },
  svelte: { label: "Svelte", color: "orange", icon: IconBrandSvelte },
  astro: { label: "Astro", color: "grape", icon: IconBrandAstro },
  angular: { label: "Angular", color: "red", icon: IconBrandAngular },
  vue: { label: "Vue", color: "green", icon: IconBrandVue },
  solid: { label: "Solid", color: "blue", icon: IconBrandSolidjs },
  gatsby: { label: "Gatsby", color: "violet", icon: IconBrandGatsby },
  nest: { label: "NestJS", color: "pink", icon: IconServer2 },
  vite: { label: "Vite", color: "violet", icon: IconBrandVite },
  react: { label: "React", color: "cyan", icon: IconBrandReact },
  expo: { label: "Expo", color: "indigo", icon: IconDeviceMobile },
  node: { label: "Node", color: "green", icon: IconBrandNodejs },
  deno: { label: "Deno", color: "gray", icon: IconBrandDeno },
  laravel: { label: "Laravel", color: "red", icon: IconBrandLaravel },
  symfony: { label: "Symfony", color: "gray", icon: IconBrandSymfony },
  php: { label: "PHP", color: "indigo", icon: IconBrandPhp },
  django: { label: "Django", color: "teal", icon: IconBrandDjango },
  flask: { label: "Flask", color: "gray", icon: IconFlask },
  fastapi: { label: "FastAPI", color: "teal", icon: IconBolt },
  python: { label: "Python", color: "yellow", icon: IconBrandPython },
  rails: { label: "Rails", color: "red", icon: IconDiamond },
  phoenix: { label: "Phoenix", color: "orange", icon: IconFlame },
  go: { label: "Go", color: "cyan", icon: IconBrandGolang },
  rust: { label: "Rust", color: "orange", icon: IconBrandRust },
  flutter: { label: "Flutter", color: "blue", icon: IconBrandFlutter },
  dotnet: { label: ".NET", color: "violet", icon: IconBrandCSharp },
  spring: { label: "Spring Boot", color: "lime", icon: IconLeaf },
  java: { label: "Java", color: "orange", icon: IconCoffee },
  godot: { label: "Godot", color: "blue", icon: IconDeviceGamepad2 },
  generic: { label: t("Generic"), color: "dark", icon: IconFolder },
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
