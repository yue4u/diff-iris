<script setup vapor lang="ts">
import { computed, ref, watch } from "vue";
import ReportCommits from "./ReportCommits.vue";
import ReportTimeline from "./ReportTimeline.vue";
import ReportTotals from "./ReportTotals.vue";
import type { ReportView } from "./report-view-types.ts";
import type {
  DependencyChange,
  DependencyLocation,
  DependencySection,
  HistoryEvent,
  Report,
} from "../shared/types.ts";

type ClientReport = Report & {
  semver: Record<string, [number, number, number] | null>;
  diffIrisVersion: string;
};
type SummaryEntry = { name: string; initial?: DependencyLocation; final?: DependencyLocation };
type SummaryKind = "added" | "updated" | "removed";
type UpdateKind = "major" | "minor" | "patch" | "other";
type ChangeGroup = { section: DependencySection; label: string; changes: DependencyChange[] };

const { report } = defineProps<{ report: ClientReport }>();
const sectionOrder: Array<[DependencySection, string]> = [
  ["dependencies", "deps"],
  ["devDependencies", "dev"],
  ["peerDependencies", "peer"],
  ["optionalDependencies", "optional"],
];
const updateLabels: Record<UpdateKind, [string, string]> = {
  major: ["Major", "breaking changes"],
  minor: ["Minor", "new features"],
  patch: ["Patch", "fixes"],
  other: ["Other", "uncategorized"],
};
const updateOrder: UpdateKind[] = ["major", "minor", "patch", "other"];
const dates = [...new Set(report.events.map((event) => event.commit.utcDate))];
const dateIndex = new Map(dates.map((date, index) => [date, index]));

function lowerBound(value: string): number {
  let low = 0;
  let high = dates.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (dates[middle] < value) low = middle + 1;
    else high = middle;
  }
  return Math.min(low, dates.length - 1);
}

function upperBound(value: string): number {
  let low = 0;
  let high = dates.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (dates[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

function rangeFromUrl(): [number, number] {
  const last = dates.length - 1;
  const parameters = new URLSearchParams(window.location.search);
  const from = parameters.get("from");
  const to = parameters.get("to");
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  const initialStart = from && pattern.test(from) ? lowerBound(from) : 0;
  const initialEnd = to && pattern.test(to) ? upperBound(to) : last;
  return initialStart <= initialEnd ? [initialStart, initialEnd] : [0, last];
}

const initialRange = dates.length ? rangeFromUrl() : [0, 0];
const start = ref(initialRange[0]);
const end = ref(initialRange[1]);
const renderedStart = ref(start.value);
const renderedEnd = ref(end.value);
const showAllCommits = ref(false);
let renderTimer: ReturnType<typeof setTimeout> | undefined;

const commitsByDate = Array.from({ length: dates.length }, () => 0);
const changesByDate = Array.from({ length: dates.length }, () => 0);
for (const event of report.events) {
  const index = dateIndex.get(event.commit.utcDate)!;
  commitsByDate[index]++;
  changesByDate[index] += event.changes.length;
}
const commitPrefix = [0];
const changePrefix = [0];
for (let index = 0; index < dates.length; index++) {
  commitPrefix.push(commitPrefix[index] + commitsByDate[index]);
  changePrefix.push(changePrefix[index] + changesByDate[index]);
}

function saveRange(): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("from", dates[start.value]);
    url.searchParams.set("to", dates[end.value]);
    window.history.replaceState(null, "", url);
  } catch {
    // Some embedded viewers do not allow file URL history updates.
  }
}

function scheduleDetails(immediate = false): void {
  saveRange();
  clearTimeout(renderTimer);
  const apply = () => {
    renderedStart.value = start.value;
    renderedEnd.value = end.value;
    showAllCommits.value = false;
  };
  if (immediate) apply();
  else renderTimer = setTimeout(apply, 120);
}

function setStart(value: number): void {
  start.value = value;
  if (start.value > end.value) end.value = start.value;
  scheduleDetails();
}

function setEnd(value: number): void {
  end.value = value;
  if (end.value < start.value) start.value = end.value;
  scheduleDetails();
}

function inputNumber(event: Event): number {
  return Number((event.currentTarget as HTMLInputElement).value);
}

function resetRange(): void {
  start.value = 0;
  end.value = dates.length - 1;
  scheduleDetails();
}

const denominator = Math.max(1, dates.length - 1);
const trackStyle = computed(() => ({
  "--start": `${(start.value / denominator) * 100}%`,
  "--end": `${(end.value / denominator) * 100}%`,
}));
const rangeSummary = computed(() => {
  const commits = commitPrefix[end.value + 1] - commitPrefix[start.value];
  const changes = changePrefix[end.value + 1] - changePrefix[start.value];
  return `${dates[start.value]} – ${dates[end.value]} · ${commits} commits · ${changes} changes`;
});
const visibleEvents = computed(() =>
  report.events
    .filter(
      (event) =>
        event.commit.utcDate >= dates[renderedStart.value] &&
        event.commit.utcDate <= dates[renderedEnd.value],
    )
    .toReversed(),
);

function sameLocation(left?: DependencyLocation, right?: DependencyLocation): boolean {
  return left?.section === right?.section && left?.version === right?.version;
}

function summarizePackages(events: HistoryEvent[]): Record<SummaryKind, SummaryEntry[]> {
  const packages = new Map<string, SummaryEntry>();
  for (const event of events.toReversed()) {
    for (const change of event.changes) {
      const existing = packages.get(change.name);
      if (existing) existing.final = change.current;
      else
        packages.set(change.name, {
          name: change.name,
          initial: change.previous,
          final: change.current,
        });
    }
  }
  const summary: Record<SummaryKind, SummaryEntry[]> = { added: [], updated: [], removed: [] };
  for (const entry of packages.values()) {
    if (sameLocation(entry.initial, entry.final)) continue;
    if (!entry.initial && entry.final) summary.added.push(entry);
    else if (entry.initial && !entry.final) summary.removed.push(entry);
    else summary.updated.push(entry);
  }
  for (const entries of Object.values(summary)) {
    entries.sort((left, right) => left.name.localeCompare(right.name));
  }
  return summary;
}

const packageSummary = computed(() => summarizePackages(visibleEvents.value));
const totals = computed(() => ({
  commits: visibleEvents.value.length,
  added: packageSummary.value.added.length,
  removed: packageSummary.value.removed.length,
  updated: packageSummary.value.updated.length,
}));

function updateKind(entry: SummaryEntry): UpdateKind {
  const initial = report.semver[entry.initial!.version];
  const final = report.semver[entry.final!.version];
  if (!initial || !final) return "other";
  if (initial[0] !== final[0]) return "major";
  if (initial[1] !== final[1]) return "minor";
  if (initial[2] !== final[2]) return "patch";
  return "other";
}

const updatedGroups = computed(() => {
  const groups = Map.groupBy(packageSummary.value.updated, updateKind);
  return updateOrder.flatMap((kind) => {
    const entries = groups.get(kind);
    return entries ? [{ kind, entries }] : [];
  });
});

function locationText(location?: DependencyLocation, includeSection = false): string {
  if (!location) return "";
  const section = sectionOrder.find(([name]) => name === location.section)?.[1];
  return includeSection ? `${location.version} · ${section}` : location.version;
}

const committers = computed(() =>
  [...Map.groupBy(visibleEvents.value, (event) => event.commit.authorName)]
    .map(([name, commits]) => {
      const summary = summarizePackages(commits);
      return {
        name,
        count: commits.length,
        packages: (["added", "removed", "updated"] as const).flatMap((type) =>
          summary[type].map((entry) => ({ name: entry.name, type })),
        ),
      };
    })
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)),
);

const bins = computed(() => {
  const count = Math.min(96, Math.max(1, dates.length));
  const values = Array.from({ length: count }, () => 0);
  for (const event of report.events) {
    const index = dateIndex.get(event.commit.utcDate)!;
    values[Math.min(count - 1, Math.floor((index * count) / dates.length))] += event.changes.length;
  }
  const maximum = Math.max(...values, 1);
  return values.map((value) => Math.max(2, Math.round((value / maximum) * 54)));
});

function changesBySection(changes: DependencyChange[]): ChangeGroup[] {
  const groups = new Map<DependencySection, DependencyChange[]>(
    sectionOrder.map(([section]) => [section, []]),
  );
  for (const change of changes) {
    if (change.type === "updated" && change.previous!.section !== change.current!.section) {
      groups.get(change.previous!.section)!.push({
        type: "removed",
        name: change.name,
        previous: change.previous,
      });
      groups.get(change.current!.section)!.push({
        type: "added",
        name: change.name,
        current: change.current,
      });
    } else {
      groups.get(change.current?.section ?? change.previous!.section)!.push(change);
    }
  }
  return sectionOrder.flatMap(([section, label]) => {
    const sectionChanges = groups.get(section)!;
    return sectionChanges.length ? [{ section, label, changes: sectionChanges }] : [];
  });
}

function operation(change: DependencyChange): string {
  return { added: "+", updated: "~", removed: "-" }[change.type];
}

function previousVersion(change: DependencyChange): string {
  return change.previous?.version ?? "";
}

function currentVersion(change: DependencyChange): string {
  return change.current?.version ?? "";
}

const popoverTimers = new Map<string, ReturnType<typeof setTimeout>>();
function showPopover(id: string): void {
  clearTimeout(popoverTimers.get(id));
  const popover = document.querySelector<HTMLElement>(`#${id}`);
  if (!popover) return;
  if (!popover.matches(":popover-open")) popover.showPopover();
}

function hidePopover(id: string): void {
  popoverTimers.set(
    id,
    setTimeout(() => {
      const popover = document.querySelector<HTMLElement>(`#${id}`);
      if (popover?.matches(":popover-open")) popover.hidePopover();
    }, 100),
  );
}

function cancelPopoverHide(id: string): void {
  clearTimeout(popoverTimers.get(id));
}

let draggedHandle: "start" | "end" | undefined;
function trackIndex(event: PointerEvent): number {
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return Math.round(
    Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)) * (dates.length - 1),
  );
}

function moveTrack(event: PointerEvent): void {
  if (!draggedHandle) return;
  const value = trackIndex(event);
  if (draggedHandle === "start") setStart(value);
  else setEnd(value);
}

function startTrackDrag(event: PointerEvent): void {
  if (event.button !== 0) return;
  const value = trackIndex(event);
  draggedHandle = Math.abs(value - start.value) <= Math.abs(value - end.value) ? "start" : "end";
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  moveTrack(event);
  event.preventDefault();
}

function stopTrackDrag(event: PointerEvent): void {
  const track = event.currentTarget as HTMLElement;
  if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
  draggedHandle = undefined;
}

watch(visibleEvents, () => {
  showAllCommits.value = false;
});

// Keep refs nested so Vapor's template compiler and vue-tsc agree on explicit unwrapping.
const view = {
  bins,
  committers,
  end,
  packageSummary,
  rangeSummary,
  showAllCommits,
  start,
  totals,
  trackStyle,
  updatedGroups,
  visibleEvents,
} satisfies ReportView;
</script>

<template>
  <main>
    <header class="hero">
      <div class="eyebrow">diff-iris · package.json</div>
      <h1>{{ report.repository }}</h1>
      <p class="revision">
        {{ report.repository }} · {{ report.ref }} · <code>{{ report.revision.slice(0, 12) }}</code>
        ·
        <a
          v-if="report.repositoryUrl"
          :href="report.repositoryUrl"
          rel="noreferrer"
          target="_blank"
          >{{ report.repositoryUrl }}</a
        >
      </p>
      <p class="generated">
        <span>Generated {{ report.generatedAt }}</span>
        <span>diff-iris {{ report.diffIrisVersion }}</span>
      </p>
    </header>

    <ReportTimeline
      v-if="dates.length"
      :dates="dates"
      :view="view"
      :input-number="inputNumber"
      :lower-bound="lowerBound"
      :move-track="moveTrack"
      :reset-range="resetRange"
      :set-end="setEnd"
      :set-start="setStart"
      :start-track-drag="startTrackDrag"
      :stop-track-drag="stopTrackDrag"
      :upper-bound="upperBound"
    />

    <ReportTotals
      :view="view"
      :update-labels="updateLabels"
      :cancel-popover-hide="cancelPopoverHide"
      :hide-popover="hidePopover"
      :location-text="locationText"
      :show-popover="showPopover"
    />

    <ReportCommits
      :dates="dates"
      :view="view"
      :changes-by-section="changesBySection"
      :current-version="currentVersion"
      :operation="operation"
      :previous-version="previousVersion"
    />
  </main>
</template>
