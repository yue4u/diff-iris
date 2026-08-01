<script setup vapor lang="ts">
import type { DependencyChange, DependencySection } from "../shared/types.ts";
import type { ReportView } from "./report-view-types.ts";

type ChangeGroup = { section: DependencySection; label: string; changes: DependencyChange[] };

defineProps<{
  dates: string[];
  view: Pick<ReportView, "showAllCommits" | "visibleEvents">;
  changesBySection: (changes: DependencyChange[]) => ChangeGroup[];
  currentVersion: (change: DependencyChange) => string;
  operation: (change: DependencyChange) => string;
  previousVersion: (change: DependencyChange) => string;
}>();
</script>

<template>
  <div class="section-title"><h2>Dependency changes</h2></div>
  <section
    v-if="view.visibleEvents.value.length"
    id="events"
    aria-label="Dependency change commits"
  >
    <article
      v-for="(event, index) in view.visibleEvents.value"
      :key="event.commit.sha"
      class="commit"
      :hidden="!view.showAllCommits.value && index >= 3 ? 'until-found' : undefined"
      @beforematch="view.showAllCommits.value = true"
    >
      <header class="commit-header">
        <h3 class="commit-subject">
          <code class="sha">{{ event.commit.sha.slice(0, 12) }}</code
          >{{ event.commit.subject || "(no subject)" }}
        </h3>
        <p class="metadata">
          <span class="timestamp">{{ event.commit.committedAt }}</span>
          <span class="author"
            >{{ event.commit.authorName }} &lt;{{ event.commit.authorEmail }}&gt;</span
          >
        </p>
      </header>
      <section
        v-for="group in changesBySection(event.changes)"
        :key="group.section"
        class="change-group"
      >
        <h4 class="change-group-title">{{ group.label }}</h4>
        <ul class="changes">
          <li
            v-for="change in group.changes"
            :key="`${change.type}:${change.name}`"
            :class="`change change-${change.type}`"
          >
            <span class="change-kind">{{ operation(change) }}</span>
            <strong class="package">{{ change.name }}</strong>
            <span v-if="change.type !== 'updated'" class="change-value">
              {{ change.type === "added" ? currentVersion(change) : previousVersion(change) }}
            </span>
            <span v-else class="version-diff">
              <span class="change-value previous-value">{{ previousVersion(change) }}</span>
              <span class="arrow">→</span>
              <span class="change-value current-value">{{ currentVersion(change) }}</span>
            </span>
          </li>
        </ul>
      </section>
      <details class="message">
        <summary>Full commit message</summary>
        <pre class="message-body">{{ event.commit.message || "(empty message)" }}</pre>
      </details>
    </article>
    <button
      v-if="!view.showAllCommits.value && view.visibleEvents.value.length > 3"
      class="reveal-commits"
      type="button"
      @click="view.showAllCommits.value = true"
    >
      Show {{ view.visibleEvents.value.length - 3 }} more commits
    </button>
  </section>
  <p v-else class="empty">
    {{
      dates.length
        ? "No commits fall within this range."
        : "No dependency changes were found in package.json history."
    }}
  </p>
</template>
