import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { parseArgs } from "node:util";
import ownershipClient from "virtual:inline-ownership-client";
import ownershipStyles from "../browser/ownership.css?raw";
import type {
  RankedAuthor,
  OwnershipMetric as Metric,
  OwnershipReport,
} from "../shared/ownership-types.ts";

interface Output {
  write(chunk: string | Uint8Array): unknown;
}

interface OwnershipOptions {
  args: string[];
  cwd: string;
  stdout: Output;
  stderr: Output;
}

interface OwnershipArguments {
  format: OutputFormat;
  jobs: number;
  pattern?: RegExp;
  patterns: string[];
  rank: boolean;
}

type OutputFormat = "text" | "json" | "html";

interface HeadFile {
  objectId: string;
  path: string;
}

interface BlameResult {
  attributed: boolean;
  lines: number;
}

interface OwnershipCount {
  files: number;
  lines: number;
}

export const ownershipHelp = `Usage: diff-iris ownership [options] PATTERN...
       diff-iris ownership --rank [options]

Count files in HEAD with at least one surviving line attributed to a matching author.
Patterns are JavaScript regular expressions and multiple patterns are joined with OR.

Options:
  -a, --author PATTERN  Add an author pattern
      --format FORMAT   Output text, json, or html (default: text)
  -j, --jobs NUMBER     Maximum concurrent blame processes
      --rank            Count and rank every author instead of matching patterns
  -h, --help            Show this help
`;

function parsePositiveInteger(value: string | undefined, option: string): number {
  if (!value || !/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(`${option} requires a positive integer`);
  }
  return Number(value);
}

function parseArguments(args: string[]): OwnershipArguments {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      author: { type: "string", short: "a", multiple: true },
      format: { type: "string" },
      jobs: { type: "string", short: "j" },
      rank: { type: "boolean" },
    },
  });
  const patterns = [...(values.author ?? []), ...positionals];
  const format = values.format ?? "text";
  if (format !== "text" && format !== "json" && format !== "html") {
    throw new Error("--format must be text, json, or html");
  }
  const jobs = values.jobs
    ? parsePositiveInteger(values.jobs, "--jobs")
    : Math.min(32, Math.max(1, availableParallelism()));
  const rank = values.rank ?? false;

  if (rank && patterns.length > 0)
    throw new Error("--rank cannot be combined with author patterns");
  if (!rank && patterns.length === 0)
    throw new Error("ownership requires an author pattern or --rank");
  const source = patterns.map((pattern) => `(?:${pattern})`).join("|");
  try {
    return {
      jobs,
      pattern: rank ? undefined : new RegExp(source),
      patterns,
      rank,
      format,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid author pattern: ${detail}`);
  }
}

function collect(command: string, args: string[], cwd: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    child.stdout.on("data", (chunk: Uint8Array) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Uint8Array) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        const size = stdout.reduce((total, chunk) => total + chunk.byteLength, 0);
        const result = new Uint8Array(size);
        let offset = 0;
        for (const chunk of stdout) {
          result.set(chunk, offset);
          offset += chunk.byteLength;
        }
        resolve(result);
      } else {
        reject(new Error(new TextDecoder().decode(Buffer.concat(stderr)).trim() || "git failed"));
      }
    });
  });
}

async function headFiles(cwd: string): Promise<HeadFile[]> {
  const output = await collect("git", ["ls-tree", "-r", "-z", "HEAD"], cwd);
  return new TextDecoder()
    .decode(output)
    .split("\0")
    .flatMap((record) => {
      const separator = record.indexOf("\t");
      if (separator < 0) return [];
      const metadata = /^\d+ blob ([0-9a-f]+)$/.exec(record.slice(0, separator));
      if (!metadata) return [];
      return [{ objectId: metadata[1], path: record.slice(separator + 1) }];
    });
}

async function prepareCommitGraph(cwd: string, fileCount: number): Promise<void> {
  if (fileCount < 256) return;
  try {
    await collect(
      "git",
      ["commit-graph", "write", "--reachable", "--changed-paths", "--no-progress"],
      cwd,
    );
  } catch {
    // The graph is an optional Git performance cache; read-only repositories still work.
  }
}

async function candidateFiles(
  cwd: string,
  files: HeadFile[],
  pattern: RegExp,
): Promise<HeadFile[]> {
  const candidates = new Set<string>();
  const child = spawn(
    "git",
    [
      "log",
      "--reverse",
      "--topo-order",
      "--find-renames=100%",
      "--name-status",
      "-z",
      "--format=DIFF_IRIS_COMMIT%x00%aN%x00",
      "HEAD",
    ],
    { cwd, stdio: ["ignore", "pipe", "pipe"] },
  );
  const stderr: Uint8Array[] = [];
  const decoder = new TextDecoder();
  let remainder = "";
  let authorMatches = false;
  let expectingAuthor = false;
  let expectingPath: "added" | "deleted" | "changed" | "rename-from" | "rename-to" | undefined;
  let renameFrom = "";
  let added: string[] = [];
  let deleted: string[] = [];
  let changed: string[] = [];
  let renamed: Array<[string, string]> = [];

  const applyCommit = (): void => {
    const propagatesOwnership = deleted.some((path) => candidates.has(path));
    for (const path of deleted) candidates.delete(path);
    if (authorMatches) for (const path of [...added, ...changed]) candidates.add(path);
    for (const [from, to] of renamed) {
      const followsOwnership = candidates.delete(from);
      if (followsOwnership || authorMatches) candidates.add(to);
    }
    // Modified renames appear as delete/add pairs at the tree-only 100% threshold. Small pairs
    // are cheap to retain as candidates; blame removes any unrelated additions.
    if (propagatesOwnership && added.length <= 8) {
      for (const path of added) candidates.add(path);
    }
    added = [];
    deleted = [];
    changed = [];
    renamed = [];
  };

  const consume = (rawToken: string): void => {
    const token = rawToken.replace(/^\n+/, "");
    if (expectingAuthor) {
      authorMatches = pattern.test(token);
      expectingAuthor = false;
      return;
    }
    if (expectingPath) {
      if (expectingPath === "added") added.push(token);
      else if (expectingPath === "deleted") deleted.push(token);
      else if (expectingPath === "rename-from") {
        renameFrom = token;
        expectingPath = "rename-to";
        return;
      } else if (expectingPath === "rename-to") renamed.push([renameFrom, token]);
      else changed.push(token);
      expectingPath = undefined;
      return;
    }
    if (token === "DIFF_IRIS_COMMIT") {
      applyCommit();
      expectingAuthor = true;
      return;
    }
    const status = token[0];
    if (status === "A") expectingPath = "added";
    else if (status === "D") expectingPath = "deleted";
    else if (status === "R") expectingPath = "rename-from";
    else if (status) expectingPath = "changed";
  };

  child.stderr.on("data", (chunk: Uint8Array) => stderr.push(chunk));
  const completed = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(new TextDecoder().decode(Buffer.concat(stderr)).trim() || "git log failed"),
        );
    });
  });
  for await (const chunk of child.stdout) {
    const text = remainder + decoder.decode(chunk, { stream: true });
    const tokens = text.split("\0");
    remainder = tokens.pop()!;
    for (const token of tokens) consume(token);
  }
  remainder += decoder.decode();
  if (remainder) consume(remainder);
  await completed;
  applyCommit();

  return files.filter((file) => candidates.has(file.path));
}

async function countHeadLines(cwd: string, files: HeadFile[]): Promise<number> {
  if (files.length === 0) return 0;
  const child = spawn("git", ["cat-file", "--batch"], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stderr: Uint8Array[] = [];
  let header = "";
  let remaining: number | undefined;
  let skipSeparator = false;
  let blobSize = 0;
  let binary = false;
  let newlines = 0;
  let lastByte = -1;
  let total = 0;

  const finishBlob = (): void => {
    if (!binary) total += newlines + (blobSize > 0 && lastByte !== 10 ? 1 : 0);
    remaining = undefined;
    skipSeparator = true;
  };

  child.stderr.on("data", (chunk: Uint8Array) => stderr.push(chunk));
  child.stdin.end(`${files.map((file) => file.objectId).join("\n")}\n`);
  const completed = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            new TextDecoder().decode(Buffer.concat(stderr)).trim() || "git cat-file failed",
          ),
        );
    });
  });

  for await (const chunk of child.stdout) {
    const bytes = chunk as Uint8Array;
    let offset = 0;
    while (offset < bytes.byteLength) {
      if (skipSeparator) {
        if (bytes[offset++] !== 10) throw new Error("git cat-file returned invalid blob framing");
        skipSeparator = false;
      } else if (remaining === undefined) {
        let newline = offset;
        while (newline < bytes.byteLength && bytes[newline] !== 10) newline++;
        header += new TextDecoder().decode(bytes.subarray(offset, newline));
        offset = newline;
        if (offset === bytes.byteLength) continue;
        offset++;
        const match = /^[0-9a-f]+ blob (\d+)$/.exec(header);
        if (!match) throw new Error(`git cat-file returned an unexpected header: ${header}`);
        blobSize = Number(match[1]);
        remaining = blobSize;
        header = "";
        binary = false;
        newlines = 0;
        lastByte = -1;
        if (remaining === 0) finishBlob();
      } else {
        const length = Math.min(remaining, bytes.byteLength - offset);
        const end = offset + length;
        for (; offset < end; offset++) {
          lastByte = bytes[offset];
          if (lastByte === 0) binary = true;
          else if (lastByte === 10) newlines++;
        }
        remaining -= length;
        if (remaining === 0) finishBlob();
      }
    }
  }
  await completed;
  if (remaining !== undefined || header || skipSeparator) {
    throw new Error("git cat-file returned truncated blob data");
  }
  return total;
}

function readBlame(
  cwd: string,
  path: string,
  visit: (author: string, lines: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["blame", "--incremental", "HEAD", "--", path], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderr: Uint8Array[] = [];
    const decoder = new TextDecoder();
    let remainder = "";
    const authors = new Map<string, string>();
    let commit = "";
    let hunkLines = 0;
    let counted = false;

    const applyHunk = (author: string): void => {
      if (counted) return;
      counted = true;
      visit(author, hunkLines);
    };

    const inspect = (text: string): void => {
      for (const line of text.split("\n")) {
        const header = /^([0-9a-f^]{40,64}) \d+ \d+ (\d+)$/.exec(line);
        if (header) {
          commit = header[1];
          hunkLines = Number(header[2]);
          counted = false;
          const author = authors.get(commit);
          if (author) applyHunk(author);
        } else if (line.startsWith("author ")) {
          const author = line.slice(7);
          authors.set(commit, author);
          applyHunk(author);
        }
      }
    };

    child.stdout.on("data", (chunk: Uint8Array) => {
      const text = remainder + decoder.decode(chunk, { stream: true });
      const boundary = text.lastIndexOf("\n");
      if (boundary < 0) remainder = text;
      else {
        inspect(text.slice(0, boundary));
        remainder = text.slice(boundary + 1);
      }
    });
    child.stderr.on("data", (chunk: Uint8Array) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        remainder += decoder.decode();
        inspect(remainder);
        resolve();
      } else {
        reject(
          new Error(
            new TextDecoder().decode(Buffer.concat(stderr)).trim() ||
              `git blame failed for ${path}`,
          ),
        );
      }
    });
  });
}

async function blameFile(cwd: string, path: string, pattern: RegExp): Promise<BlameResult> {
  let attributed = false;
  let lines = 0;
  await readBlame(cwd, path, (author, hunkLines) => {
    if (!pattern.test(author)) return;
    attributed = true;
    lines += hunkLines;
  });
  return { attributed, lines };
}

async function blameAuthors(cwd: string, path: string): Promise<Map<string, number>> {
  const authors = new Map<string, number>();
  await readBlame(cwd, path, (author, lines) => {
    authors.set(author, (authors.get(author) ?? 0) + lines);
  });
  return authors;
}

async function countOwnership(
  files: HeadFile[],
  jobs: number,
  check: (path: string) => Promise<BlameResult>,
): Promise<OwnershipCount> {
  let next = 0;
  let attributed = 0;
  let lines = 0;
  async function worker(): Promise<void> {
    while (next < files.length) {
      const file = files[next++];
      const result = await check(file.path);
      if (result.attributed) attributed++;
      lines += result.lines;
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, worker));
  return { files: attributed, lines };
}

async function countAuthors(
  cwd: string,
  files: HeadFile[],
  jobs: number,
): Promise<Map<string, OwnershipCount>> {
  const totals = new Map<string, OwnershipCount>();
  let next = 0;
  async function worker(): Promise<void> {
    while (next < files.length) {
      const file = files[next++];
      const authors = await blameAuthors(cwd, file.path);
      for (const [author, lines] of authors) {
        const total = totals.get(author) ?? { files: 0, lines: 0 };
        total.files++;
        total.lines += lines;
        totals.set(author, total);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, worker));
  return totals;
}

function metric(count: number, total: number): Metric {
  return {
    count,
    percentage: Number((total === 0 ? 0 : (count / total) * 100).toFixed(2)),
    total,
  };
}

function rankAuthors(
  authors: Map<string, OwnershipCount>,
  fileCount: number,
  totalLines: number,
): RankedAuthor[] {
  return [...authors]
    .sort(
      ([leftName, left], [rightName, right]) =>
        right.files - left.files || right.lines - left.lines || leftName.localeCompare(rightName),
    )
    .map(([author, count], index) => ({
      author,
      files: metric(count.files, fileCount),
      lines: metric(count.lines, totalLines),
      rank: index + 1,
    }));
}

function metricText(value: Metric, unit: string): string {
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

function renderOutput(report: OwnershipReport, format: OutputFormat): string {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  if (format === "html") return renderHtml(report);
  return renderText(report);
}

export async function runOwnership(options: OwnershipOptions): Promise<number> {
  if (options.args.includes("--help") || options.args.includes("-h")) {
    options.stdout.write(ownershipHelp);
    return 0;
  }
  try {
    const { format, jobs, pattern, patterns, rank } = parseArguments(options.args);
    const files = await headFiles(options.cwd);
    await prepareCommitGraph(options.cwd, files.length);
    if (rank) {
      const [authors, totalLines] = await Promise.all([
        countAuthors(options.cwd, files, jobs),
        countHeadLines(options.cwd, files),
      ]);
      const report: OwnershipReport = {
        mode: "rank",
        authors: rankAuthors(authors, files.length, totalLines),
        files: files.length,
        lines: totalLines,
      };
      options.stdout.write(renderOutput(report, format));
      return 0;
    }
    const [candidates, totalLines] = await Promise.all([
      candidateFiles(options.cwd, files, pattern!),
      countHeadLines(options.cwd, files),
    ]);
    const ownership = await countOwnership(candidates, jobs, (path) =>
      blameFile(options.cwd, path, pattern!),
    );
    const report: OwnershipReport = {
      mode: "match",
      patterns,
      files: metric(ownership.files, files.length),
      lines: metric(ownership.lines, totalLines),
    };
    options.stdout.write(renderOutput(report, format));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.stderr.write(`diff-iris: ${message}\n`);
    return 1;
  }
}
