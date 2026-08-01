import ownershipClient from "virtual:inline-ownership-client";
import ownershipStyles from "../../browser/ownership.css?raw";
import type { OwnershipMetric, OwnershipReport } from "../../shared/ownership-types.ts";
import type { OutputFormat } from "./arguments.ts";

function metricText(value: OwnershipMetric, unit: string): string {
  return `${value.count} / ${value.total} ${unit} (${value.percentage.toFixed(2)}%)`;
}

function renderText(report: OwnershipReport): string {
  if (report.mode === "match") {
    return `${metricText(report.files, "files")} and ${metricText(report.lines, "lines")} are attributed to ${report.patterns.join(",")}\n`;
  }
  if (report.authors.length === 0) return "No authors found in HEAD.\n";
  return `${report.authors
    .map(
      (entry) =>
        `${entry.rank}. ${entry.author} — ${metricText(entry.files, "files")} · ${metricText(entry.lines, "lines")}`,
    )
    .join("\n")}\n`;
}

function serializeForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function renderHtml(report: OwnershipReport): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>diff-iris ownership</title>
  <style>${ownershipStyles}</style>
</head>
<body>
  <div id="ownership-app"></div>
  <script id="ownership-data" type="application/json">${serializeForHtml(report)}</script>
  <script>${ownershipClient}</script>
</body>
</html>
`;
}

export function renderOwnership(report: OwnershipReport, format: OutputFormat): string {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  if (format === "html") return renderHtml(report);
  return renderText(report);
}
