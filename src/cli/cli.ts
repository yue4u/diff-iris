#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Temporal } from "temporal-polyfill-lite";
import packageJson from "../../package.json" with { type: "json" };
import { createReport } from "./git.ts";
import { renderReport } from "./report.ts";
import type { Report } from "../shared/types.ts";

interface CliOptions {
  args?: string[];
  cwd?: string;
  isTTY?: boolean;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
}

const help = `Usage: diff-iris

Analyze dependency changes in the root package.json reachable from HEAD.

When stdout is a terminal, writes .diff-iris/index.html in the repository.
When stdout is redirected or piped, writes the HTML document to stdout.

Options:
      --since DATE Filter changes on or after DATE (UTC, YYYY-MM-DD)
      --until DATE Filter changes on or before DATE (UTC, YYYY-MM-DD)
  -h, --help     Show this help
  -v, --version  Show the version
`;

interface DateRange {
  since?: string;
  until?: string;
}

function parseDate(value: string, option: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${option} must use YYYY-MM-DD`);
  }
  try {
    return Temporal.PlainDate.from(value).toString();
  } catch {
    throw new Error(`${option} is not a valid calendar date`);
  }
}

function parseDateRange(args: string[]): DateRange {
  const range: DateRange = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    const separator = argument.indexOf("=");
    const option = separator < 0 ? argument : argument.slice(0, separator);
    if (option !== "--since" && option !== "--until") {
      throw new Error(`unsupported argument: ${argument}`);
    }
    const inlineValue = separator < 0 ? undefined : argument.slice(separator + 1);
    const value = inlineValue ?? args[++index];
    if (!value) throw new Error(`${option} requires a date`);
    const key = option === "--since" ? "since" : "until";
    if (range[key]) throw new Error(`${option} may only be specified once`);
    range[key] = parseDate(value, option);
  }
  if (range.since && range.until && range.since > range.until) {
    throw new Error("--since must not be after --until");
  }
  return range;
}

function filterReport(report: Report, range: DateRange): void {
  report.events = report.events.filter(
    (event) =>
      (!range.since || event.commit.utcDate >= range.since) &&
      (!range.until || event.commit.utcDate <= range.until),
  );
  report.firstDate = report.events[0]?.commit.utcDate ?? null;
  report.lastDate = report.events.at(-1)?.commit.utcDate ?? null;
  report.totals = { commits: report.events.length, changes: 0, added: 0, updated: 0, removed: 0 };
  for (const event of report.events) {
    report.totals.changes += event.changes.length;
    for (const change of event.changes) report.totals[change.type]++;
  }
}

export async function runCli(options: CliOptions = {}): Promise<number> {
  const args = options.args ?? process.argv.slice(2);
  const cwd = options.cwd ?? process.cwd();
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const isTTY = options.isTTY ?? Boolean(process.stdout.isTTY);

  if (args.includes("--help") || args.includes("-h")) {
    stdout.write(help);
    return 0;
  }
  if (args.includes("--version") || args.includes("-v")) {
    stdout.write(`${packageJson.version}\n`);
    return 0;
  }
  let range: DateRange;
  try {
    range = parseDateRange(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`diff-iris: ${message}\n`);
    return 1;
  }

  try {
    const { report, repositoryRoot, warnings } = await createReport(cwd);
    filterReport(report, range);
    for (const warning of warnings) stderr.write(`diff-iris: warning: ${warning}\n`);
    const html = renderReport(report);
    if (!isTTY) {
      stdout.write(html);
      return 0;
    }

    const outputPath = join(repositoryRoot, ".diff-iris", "index.html");
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, html, "utf8");
    stderr.write(`Created ${outputPath}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`diff-iris: ${message}\n`);
    return 1;
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.filename === realpathSync(entryPath)) {
  process.exitCode = await runCli();
}
