import clientScript from "virtual:inline-report-client";
import styles from "../browser/report.css?raw";
import packageJson from "../../package.json?raw";
import { minVersion } from "semver";
import type { Report } from "../shared/types.ts";

const diffIrisVersion = (JSON.parse(packageJson) as { version: string }).version;

function minimumVersion(requirement: string): [number, number, number] | null {
  try {
    const version = minVersion(requirement);
    return version ? [version.major, version.minor, version.patch] : null;
  } catch {
    return null;
  }
}

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

export function renderReport(report: Report): string {
  const requirements = new Set<string>();
  for (const event of report.events) {
    for (const change of event.changes) {
      if (change.previous) requirements.add(change.previous.version);
      if (change.current) requirements.add(change.current.version);
    }
  }
  const semver = Object.fromEntries(
    [...requirements].map((requirement) => [requirement, minimumVersion(requirement)]),
  );
  const clientReport = { ...report, semver, diffIrisVersion };
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#f8f5fa" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#261c2c" media="(prefers-color-scheme: dark)">
  <title>${escapeHtml(report.repository)} dependency history</title>
  <style>${styles}</style>
</head>
<body>
  <div id="app"></div>
  <script id="report-data" type="application/json">${serializeForHtml(clientReport)}</script>
  <script>${clientScript}</script>
</body>
</html>`;
}
