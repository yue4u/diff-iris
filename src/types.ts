export const dependencySections = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

export type DependencySection = (typeof dependencySections)[number];

export interface DependencyLocation {
  section: DependencySection;
  version: string;
}

export interface DependencyChange {
  type: "added" | "updated" | "removed";
  name: string;
  previous?: DependencyLocation;
  current?: DependencyLocation;
}

export interface CommitMetadata {
  sha: string;
  subject: string;
  message: string;
  authorName: string;
  authorEmail: string;
  committerName: string;
  committedAt: string;
  epochMilliseconds: number;
  utcDate: string;
}

export interface HistoryEvent {
  commit: CommitMetadata;
  traversalIndex: number;
  changes: DependencyChange[];
}

export interface Report {
  repository: string;
  repositoryUrl: string | null;
  revision: string;
  ref: string;
  generatedAt: string;
  firstDate: string | null;
  lastDate: string | null;
  totals: {
    commits: number;
    changes: number;
    added: number;
    updated: number;
    removed: number;
  };
  events: HistoryEvent[];
}
