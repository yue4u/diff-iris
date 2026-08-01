<script setup vapor lang="ts">
import type { ReportView } from "./report-view-types.ts";

defineProps<{
  dates: string[];
  view: Pick<ReportView, "bins" | "end" | "filterText" | "rangeSummary" | "start" | "trackStyle">;
  inputNumber: (event: Event) => number;
  lowerBound: (value: string) => number;
  moveTrack: (event: PointerEvent) => void;
  resetRange: () => void;
  setFilter: (event: Event) => void;
  setEnd: (value: number) => void;
  setStart: (value: number) => void;
  startTrackDrag: (event: PointerEvent) => void;
  stopTrackDrag: (event: PointerEvent) => void;
  upperBound: (value: string) => number;
}>();
</script>

<template>
  <section id="range-controls" class="range-panel" aria-labelledby="timeline-title">
    <h2 id="timeline-title">Timeline</h2>
    <div class="timeline">
      <div id="timeline-bars" class="timeline-bars" aria-hidden="true">
        <span
          v-for="(height, index) in view.bins.value"
          :key="index"
          class="timeline-bar"
          :style="{ height: `${height}px` }"
        ></span>
      </div>
      <div
        id="slider-track"
        class="slider-track"
        :style="view.trackStyle.value"
        @pointerdown="startTrackDrag"
        @pointermove="moveTrack"
        @pointerup="stopTrackDrag"
        @pointercancel="stopTrackDrag"
      ></div>
      <label class="sr-only" for="start-slider">Start of selected history range</label>
      <input
        id="start-slider"
        class="slider"
        type="range"
        min="0"
        :max="dates.length - 1"
        step="1"
        :value="view.start.value"
        aria-label="Start of selected history range"
        @input="setStart(inputNumber($event))"
      />
      <label class="sr-only" for="end-slider">End of selected history range</label>
      <input
        id="end-slider"
        class="slider"
        type="range"
        min="0"
        :max="dates.length - 1"
        step="1"
        :value="view.end.value"
        aria-label="End of selected history range"
        @input="setEnd(inputNumber($event))"
      />
    </div>
    <div class="date-controls">
      <label class="filter-control"
        >Filter committers or packages<input
          id="report-filter"
          type="search"
          placeholder="e.g. renovate or vue"
          :value="view.filterText.value"
          @input="setFilter"
      /></label>
      <label
        >From (UTC)<input
          id="start-date"
          type="date"
          :min="dates[0]"
          :max="dates.at(-1)"
          :value="dates[view.start.value]"
          @change="setStart(lowerBound(($event.currentTarget as HTMLInputElement).value))"
      /></label>
      <label
        >To (UTC)<input
          id="end-date"
          type="date"
          :min="dates[0]"
          :max="dates.at(-1)"
          :value="dates[view.end.value]"
          @change="setEnd(upperBound(($event.currentTarget as HTMLInputElement).value))"
      /></label>
      <button id="reset-range" type="button" @click="resetRange">Reset range</button>
    </div>
    <p id="range-summary">{{ view.rangeSummary.value }}</p>
    <p id="live-range" class="sr-only" aria-live="polite">Selected {{ view.rangeSummary.value }}</p>
  </section>
</template>
