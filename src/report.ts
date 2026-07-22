import clientScript from "./client.js?raw";
import styles from "./report.css.txt?raw";
import packageJson from "../package.json?raw";
import type { Report } from "./types.ts";

const diffIrisVersion = (JSON.parse(packageJson) as { version: string }).version;

function serializeForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function renderReport(report: Report): string {
  const repositoryLink = report.repositoryUrl
    ? ` · <a href="${escapeAttribute(report.repositoryUrl)}" rel="noreferrer" target="_blank">${escapeHtml(report.repositoryUrl)}</a>`
    : "";
  const totalCards = [
    [report.totals.commits, "commits"],
    [report.totals.added, "added"],
    [report.totals.removed, "removed"],
    [report.totals.updated, "updated"],
  ]
    .map(([value, label]) => {
      const packages =
        label === "commits" ? "" : `<ul class="total-packages" id="total-${label}-packages"></ul>`;
      return `<div class="total total-${label}"><strong id="total-${label}">${value}</strong><span>${label}</span>${packages}</div>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(report.repository)} dependency history</title>
  <style>${styles}</style>
</head>
<body>
  <main>
    <header class="hero">
      <div class="eyebrow">diff-iris · package.json</div>
      <h1>${escapeHtml(report.repository)}</h1>
      <p class="revision">${escapeHtml(report.repository)} · ${escapeHtml(report.ref)} · <code>${escapeHtml(report.revision.slice(0, 12))}</code>${repositoryLink}</p>
      <p class="generated">
        <span>Generated ${escapeHtml(report.generatedAt)}</span>
        <span>diff-iris ${escapeHtml(diffIrisVersion)}</span>
      </p>
    </header>
    <section class="totals" aria-label="Change totals">${totalCards}</section>
    <section class="range-panel" id="range-controls" aria-labelledby="timeline-title">
      <h2 id="timeline-title">Timeline</h2>
      <div class="timeline">
        <div class="timeline-bars" id="timeline-bars" aria-hidden="true"></div>
        <div class="slider-track" id="slider-track"></div>
        <label class="sr-only" for="start-slider">Start of selected history range</label>
        <input class="slider" id="start-slider" type="range" aria-label="Start of selected history range">
        <label class="sr-only" for="end-slider">End of selected history range</label>
        <input class="slider" id="end-slider" type="range" aria-label="End of selected history range">
      </div>
      <div class="date-controls">
        <label>From (UTC)<input id="start-date" type="date"></label>
        <label>To (UTC)<input id="end-date" type="date"></label>
        <button id="reset-range" type="button">Reset range</button>
      </div>
      <p id="range-summary"></p>
      <p class="sr-only" id="live-range" aria-live="polite"></p>
    </section>
    <div class="section-title"><h2>Dependency changes</h2></div>
    <section id="events" aria-label="Dependency change commits"></section>
    <p class="empty" id="empty-state" hidden>No commits fall within this range.</p>
  </main>
  <script id="report-data" type="application/json">${serializeForHtml(report)}</script>
  <script>${clientScript}</script>
</body>
</html>`;
}
