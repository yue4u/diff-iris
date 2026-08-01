import type { ComputedRef, Ref } from "vue";
import type { DependencyLocation, HistoryEvent } from "../shared/types.ts";

export type SummaryKind = "added" | "updated" | "removed";
export type UpdateKind = "major" | "minor" | "patch" | "other";
export type SummaryEntry = {
  name: string;
  initial?: DependencyLocation;
  final?: DependencyLocation;
};
export type CommitterSummary = { name: string; count: number; packages: string[] };
export type UpdateGroup = { kind: UpdateKind; entries: SummaryEntry[] };

export interface ReportView {
  bins: ComputedRef<number[]>;
  committers: ComputedRef<CommitterSummary[]>;
  end: Ref<number>;
  packageSummary: ComputedRef<Record<SummaryKind, SummaryEntry[]>>;
  rangeSummary: ComputedRef<string>;
  showAllCommits: Ref<boolean>;
  start: Ref<number>;
  totals: ComputedRef<Record<SummaryKind | "commits", number>>;
  trackStyle: ComputedRef<Record<"--start" | "--end", string>>;
  updatedGroups: ComputedRef<UpdateGroup[]>;
  visibleEvents: ComputedRef<HistoryEvent[]>;
}
