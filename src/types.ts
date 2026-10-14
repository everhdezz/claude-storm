/** Shared domain types mirroring the Rust models (camelCase over the wire). */

export type Framework = "next" | "vite" | "react" | "expo" | "laravel" | "node" | "generic";

export interface RepoCommand {
  id: string;
  label: string;
  command: string;
  longRunning: boolean;
}

export interface Repo {
  id: string;
  name: string;
  path: string;
  framework: Framework;
  packageManager: string | null;
  port: number | null;
  commands: RepoCommand[];
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  lastOpenedAt: string | null;
  repos: Repo[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  repoCount: number;
  rootHint: string | null;
  createdAt: string;
  lastOpenedAt: string | null;
  isOpen: boolean;
}
