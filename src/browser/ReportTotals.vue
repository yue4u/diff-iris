<script setup vapor lang="ts">
import type { DependencyLocation } from "../shared/types.ts";
import type { ReportView, UpdateKind } from "./report-view-types.ts";

defineProps<{
  view: Pick<ReportView, "committers" | "packageSummary" | "totals" | "updatedGroups">;
  updateLabels: Record<UpdateKind, [string, string]>;
  cancelPopoverHide: (id: string) => void;
  hidePopover: (id: string) => void;
  locationText: (location?: DependencyLocation, includeSection?: boolean) => string;
  showPopover: (id: string) => void;
}>();
</script>

<template>
  <section class="totals" aria-label="Change totals">
    <div class="total total-commits">
      <strong>{{ view.totals.value.commits }}</strong
      ><span>commits</span>
      <ul v-if="view.committers.value.length" class="total-committers">
        <li
          v-for="(committer, index) in view.committers.value"
          :key="committer.name"
          class="total-committer"
        >
          <button
            :id="`committer-trigger-${index}`"
            class="total-committer-trigger"
            :style="{ anchorName: `--committer-${index}` }"
            type="button"
            :popovertarget="`committer-popover-${index}`"
            :aria-label="`${committer.name}: ${committer.count} commits; show changed packages`"
            @pointerenter="showPopover(`committer-popover-${index}`)"
            @pointerleave="hidePopover(`committer-popover-${index}`)"
            @focus="showPopover(`committer-popover-${index}`)"
            @blur="hidePopover(`committer-popover-${index}`)"
          >
            <span class="total-committer-name">{{ committer.name }}</span>
            <strong class="total-committer-count">{{ committer.count }}</strong>
          </button>
        </li>
      </ul>
    </div>
    <div v-for="kind in ['added', 'removed'] as const" :key="kind" :class="`total total-${kind}`">
      <strong>{{ view.totals.value[kind] }}</strong
      ><span>{{ kind }}</span>
      <ul v-if="view.packageSummary.value[kind].length" class="total-packages">
        <li
          v-for="entry in view.packageSummary.value[kind]"
          :key="entry.name"
          class="total-package"
        >
          <strong>{{ entry.name }}</strong>
          <span :class="kind === 'added' ? 'total-final' : 'total-initial'">
            {{ locationText(kind === "added" ? entry.final : entry.initial) }}
          </span>
        </li>
      </ul>
    </div>
    <div class="total total-updated">
      <strong>{{ view.totals.value.updated }}</strong
      ><span>updated</span>
      <ul v-if="view.updatedGroups.value.length" class="total-packages">
        <li
          v-for="group in view.updatedGroups.value"
          :key="group.kind"
          :class="`total-package-group total-package-group-${group.kind}`"
        >
          <h3 class="total-package-group-title">
            <span class="total-package-group-name">{{ updateLabels[group.kind][0] }}</span>
            <span class="total-package-group-description">{{ updateLabels[group.kind][1] }}</span>
            <span class="total-package-group-count">
              {{ group.entries.length }} {{ group.entries.length === 1 ? "package" : "packages" }}
            </span>
          </h3>
          <ul class="total-package-group-list">
            <li v-for="entry in group.entries" :key="entry.name" class="total-package">
              <strong>{{ entry.name }}</strong>
              <span class="total-initial">{{
                locationText(entry.initial, entry.initial?.section !== entry.final?.section)
              }}</span>
              <span class="arrow">→</span>
              <span class="total-final">{{
                locationText(entry.final, entry.initial?.section !== entry.final?.section)
              }}</span>
            </li>
          </ul>
        </li>
      </ul>
    </div>
  </section>

  <div id="committer-popovers">
    <div
      v-for="(committer, index) in view.committers.value"
      :id="`committer-popover-${index}`"
      :key="committer.name"
      class="committer-popover"
      :style="{ positionAnchor: `--committer-${index}` }"
      popover="hint"
      @pointerenter="cancelPopoverHide(`committer-popover-${index}`)"
      @pointerleave="hidePopover(`committer-popover-${index}`)"
    >
      <strong class="committer-popover-title">{{ committer.name }}</strong>
      <span class="committer-popover-summary">
        {{ committer.packages.length }} changed
        {{ committer.packages.length === 1 ? "package" : "packages" }}
      </span>
      <ul class="committer-popover-packages">
        <li v-for="name in committer.packages" :key="name">{{ name }}</li>
      </ul>
    </div>
  </div>
</template>
