import {
  IconBrandAstro,
  IconBrandCSharp,
  IconBrandCss3,
  IconBrandDocker,
  IconBrandGit,
  IconBrandGolang,
  IconBrandHtml5,
  IconBrandJavascript,
  IconBrandKotlin,
  IconBrandNpm,
  IconBrandPhp,
  IconBrandPython,
  IconBrandReact,
  IconBrandRust,
  IconBrandSass,
  IconBrandSvelte,
  IconBrandSwift,
  IconBrandTypescript,
  IconBrandVue,
  IconBrandYarn,
  IconCoffee,
  IconDatabase,
  IconDeviceGamepad2,
  IconFile,
  IconFileText,
  IconFileTypePdf,
  IconJson,
  IconKey,
  IconLock,
  IconMarkdown,
  IconPhoto,
  IconSettings,
  IconTable,
  IconTerminal2,
  type Icon,
} from "@tabler/icons-react";

interface FileKind {
  icon: Icon;
  color: string;
}

const kind = (icon: Icon, color: string): FileKind => ({ icon, color: `var(--mantine-color-${color})` });

const BY_EXTENSION: Record<string, FileKind> = {
  ts: kind(IconBrandTypescript, "blue-4"),
  mts: kind(IconBrandTypescript, "blue-4"),
  cts: kind(IconBrandTypescript, "blue-4"),
  tsx: kind(IconBrandReact, "cyan-4"),
  jsx: kind(IconBrandReact, "cyan-4"),
  js: kind(IconBrandJavascript, "yellow-4"),
  mjs: kind(IconBrandJavascript, "yellow-4"),
  cjs: kind(IconBrandJavascript, "yellow-4"),
  json: kind(IconJson, "yellow-6"),
  md: kind(IconMarkdown, "blue-3"),
  mdx: kind(IconMarkdown, "blue-3"),
  py: kind(IconBrandPython, "blue-5"),
  rs: kind(IconBrandRust, "orange-5"),
  php: kind(IconBrandPhp, "violet-4"),
  go: kind(IconBrandGolang, "cyan-5"),
  css: kind(IconBrandCss3, "blue-5"),
  scss: kind(IconBrandSass, "pink-4"),
  sass: kind(IconBrandSass, "pink-4"),
  less: kind(IconBrandCss3, "indigo-4"),
  html: kind(IconBrandHtml5, "orange-6"),
  htm: kind(IconBrandHtml5, "orange-6"),
  vue: kind(IconBrandVue, "green-5"),
  svelte: kind(IconBrandSvelte, "orange-6"),
  astro: kind(IconBrandAstro, "orange-4"),
  cs: kind(IconBrandCSharp, "grape-4"),
  kt: kind(IconBrandKotlin, "violet-5"),
  swift: kind(IconBrandSwift, "orange-5"),
  java: kind(IconCoffee, "red-5"),
  gd: kind(IconDeviceGamepad2, "blue-4"),
  tscn: kind(IconDeviceGamepad2, "teal-4"),
  tres: kind(IconDeviceGamepad2, "teal-4"),
  godot: kind(IconDeviceGamepad2, "blue-4"),
  sql: kind(IconDatabase, "orange-3"),
  sqlite: kind(IconDatabase, "orange-3"),
  csv: kind(IconTable, "green-4"),
  sh: kind(IconTerminal2, "lime-5"),
  bash: kind(IconTerminal2, "lime-5"),
  zsh: kind(IconTerminal2, "lime-5"),
  yml: kind(IconSettings, "red-4"),
  yaml: kind(IconSettings, "red-4"),
  toml: kind(IconSettings, "gray-5"),
  ini: kind(IconSettings, "gray-5"),
  xml: kind(IconFileText, "orange-4"),
  txt: kind(IconFileText, "gray-5"),
  log: kind(IconFileText, "gray-6"),
  pdf: kind(IconFileTypePdf, "red-6"),
  lock: kind(IconLock, "gray-6"),
  pem: kind(IconKey, "yellow-5"),
  key: kind(IconKey, "yellow-5"),
};
for (const ext of ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif"]) BY_EXTENSION[ext] = kind(IconPhoto, "teal-5");

const BY_NAME: Record<string, FileKind> = {
  dockerfile: kind(IconBrandDocker, "blue-5"),
  "docker-compose.yml": kind(IconBrandDocker, "blue-5"),
  "compose.yml": kind(IconBrandDocker, "blue-5"),
  ".gitignore": kind(IconBrandGit, "orange-6"),
  ".gitattributes": kind(IconBrandGit, "orange-6"),
  "package.json": kind(IconBrandNpm, "red-5"),
  "package-lock.json": kind(IconBrandNpm, "red-7"),
  "yarn.lock": kind(IconBrandYarn, "blue-4"),
  makefile: kind(IconTerminal2, "lime-5"),
};

const FALLBACK = kind(IconFile, "gray-5");

/** Icon and color of a file, by its name or extension (like the IDE's file type icons). */
export function fileKind(name: string): FileKind {
  const lower = name.toLowerCase();
  if (BY_NAME[lower]) return BY_NAME[lower];
  if (lower.startsWith(".env")) return kind(IconKey, "yellow-5");
  const dot = lower.lastIndexOf(".");
  return (dot > 0 ? BY_EXTENSION[lower.slice(dot + 1)] : undefined) ?? FALLBACK;
}

/** Colored file type icon. */
export function FileIcon({ name, size = 15 }: { name: string; size?: number }) {
  const { icon: Glyph, color } = fileKind(name);
  return <Glyph size={size} stroke={1.6} color={color} style={{ flexShrink: 0 }} />;
}
