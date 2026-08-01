<script setup vapor lang="ts">
import type { OwnershipMetric, OwnershipReport } from "../shared/ownership-types.ts";

defineProps<{ report: OwnershipReport }>();

function metricText(metric: OwnershipMetric, unit: string): string {
  return `${metric.count} / ${metric.total} ${unit} (${metric.percentage.toFixed(2)}%)`;
}
</script>

<template>
  <main>
    <template v-if="report.mode === 'match'">
      <h1>Code attributed to {{ report.patterns.join(",") }}</h1>
      <dl>
        <dt>Files</dt>
        <dd>{{ metricText(report.files, "files") }}</dd>
        <dt>Lines</dt>
        <dd>{{ metricText(report.lines, "lines") }}</dd>
      </dl>
    </template>
    <template v-else>
      <h1>Author ranking</h1>
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Author</th>
            <th>Files</th>
            <th>Lines</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in report.authors" :key="entry.author">
            <td>{{ entry.rank }}</td>
            <th scope="row">{{ entry.author }}</th>
            <td>{{ metricText(entry.files, "files") }}</td>
            <td>{{ metricText(entry.lines, "lines") }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </main>
</template>
