import { basename } from "node:path";
import { spawn } from "node:child_process";
import { Temporal } from "temporal-polyfill-lite";
import { diffDependencies, parsePackageJson, type DependencySnapshot } from "./manifest.ts";
import type { HistoryEvent, Report } from "./types.ts";

const zeroObjectId = /^0+$/;
const rawChangePattern = /^:[0-7]{6} [0-7]{6} ([0-9a-f]+) ([0-9a-f]+) ([A-Z])[0-9]*$/;
const decoder = new TextDecoder();

interface RawCommit {
  sha: string;
  parents: string[];
  committedAt: string;
  committerName: string;
  authorName: string;
  authorEmail: string;
  subject: string;
  message: string;
  previousBlob: string | null;
  currentBlob: string | null;
}

interface GitHistory {
  repositoryRoot: string;
  repository: string;
  repositoryUrl: string | null;
  revision: string;
  ref: string;
  commits: RawCommit[];
  blobs: Map<string, string>;
}

function normalizeRemoteUrl(remote: string): string | null {
  const scp = /^git@([^:]+):(.+)$/.exec(remote);
  if (scp) return `https://${scp[1]}/${scp[2].replace(/\.git$/, "")}`;

  try {
    const url = new URL(remote);
    if (url.protocol === "ssh:") {
      return `https://${url.hostname}${url.pathname.replace(/\.git$/, "")}`;
    }
    if (url.protocol === "http:" || url.protocol === "https:") {
      url.protocol = "https:";
      url.username = "";
      url.password = "";
      url.hash = "";
      url.search = "";
      url.pathname = url.pathname.replace(/\.git$/, "");
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    return null;
  }
  return null;
}

function run(command: string, args: string[], cwd: string, input?: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];

    child.stdout.on("data", (chunk: Uint8Array) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Uint8Array) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(concatBytes(stdout));
        return;
      }
      const detail = decoder.decode(concatBytes(stderr)).trim();
      reject(new Error(detail || `${command} exited with status ${String(code)}`));
    });

    child.stdin.end(input);
  });
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function indexOfByte(bytes: Uint8Array, value: number, from: number): number {
  for (let index = from; index < bytes.byteLength; index++) {
    if (bytes[index] === value) return index;
  }
  return -1;
}

async function gitText(args: string[], cwd: string): Promise<string> {
  return decoder.decode(await run("git", args, cwd)).trim();
}

function parseLog(output: Uint8Array): RawCommit[] {
  const tokens = decoder.decode(output).split("\0");
  const commits: RawCommit[] = [];

  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].replace(/^\n+/, "") !== "DP") continue;

    const sha = tokens[index + 1];
    const parents = tokens[index + 2].split(" ").filter(Boolean);
    const committedAt = tokens[index + 3];
    const committerName = tokens[index + 4];
    const authorName = tokens[index + 5];
    const authorEmail = tokens[index + 6];
    const subject = tokens[index + 7];
    const message = tokens[index + 8].replace(/\n+$/, "");
    index += 9;

    let previousBlob: string | null = null;
    let currentBlob: string | null = null;

    while (index < tokens.length && tokens[index].replace(/^\n+/, "") !== "DP") {
      const header = tokens[index].replace(/^\n+/, "");
      const match = rawChangePattern.exec(header);
      if (match && tokens[index + 1] === "package.json") {
        previousBlob = zeroObjectId.test(match[1]) ? null : match[1];
        currentBlob = zeroObjectId.test(match[2]) ? null : match[2];
        index++;
      }
      index++;
    }
    index--;

    if (parents.length <= 1 && (previousBlob !== null || currentBlob !== null)) {
      commits.push({
        sha,
        parents,
        committedAt,
        committerName,
        authorName,
        authorEmail,
        subject,
        message,
        previousBlob,
        currentBlob,
      });
    }
  }

  return commits;
}

function parseBatch(output: Uint8Array, requested: string[]): Map<string, string> {
  const blobs = new Map<string, string>();
  let offset = 0;

  for (const expected of requested) {
    const newline = indexOfByte(output, 10, offset);
    if (newline < 0) throw new Error("git cat-file returned a truncated header");
    const header = decoder.decode(output.subarray(offset, newline));
    offset = newline + 1;
    const match = /^([0-9a-f]+) blob (\d+)$/.exec(header);
    if (!match || match[1] !== expected) {
      throw new Error(`git cat-file returned an unexpected object for ${expected}`);
    }

    const size = Number(match[2]);
    const end = offset + size;
    if (end > output.length) throw new Error(`git cat-file truncated blob ${expected}`);
    blobs.set(expected, decoder.decode(output.subarray(offset, end)));
    offset = end + 1;
  }

  return blobs;
}

async function readHistory(cwd: string): Promise<GitHistory> {
  let repositoryRoot: string;
  try {
    repositoryRoot = await gitText(["rev-parse", "--show-toplevel"], cwd);
  } catch {
    throw new Error("diff-iris must be run inside a Git repository");
  }

  let revision: string;
  try {
    revision = await gitText(["rev-parse", "--verify", "HEAD"], repositoryRoot);
  } catch {
    throw new Error("the Git repository does not have a HEAD commit");
  }

  const ref = await gitText(["rev-parse", "--abbrev-ref", "HEAD"], repositoryRoot);
  let repositoryUrl: string | null = null;
  try {
    repositoryUrl = normalizeRemoteUrl(
      await gitText(["remote", "get-url", "origin"], repositoryRoot),
    );
  } catch {
    // Repositories without an origin still produce a report.
  }
  const format = "%x00DP%x00%H%x00%P%x00%cI%x00%cN%x00%aN%x00%aE%x00%s%x00%B%x00";
  const log = await run(
    "git",
    [
      "log",
      "--full-history",
      "--topo-order",
      "--reverse",
      "--raw",
      "--no-abbrev",
      "-z",
      `--format=${format}`,
      "HEAD",
      "--",
      "package.json",
    ],
    repositoryRoot,
  );
  const commits = parseLog(log);
  if (commits.length === 0) {
    throw new Error("package.json has no history reachable from HEAD");
  }

  const objectIds = [
    ...new Set(
      commits.flatMap((commit) => [commit.previousBlob, commit.currentBlob]).filter(Boolean),
    ),
  ] as string[];
  const batch = await run(
    "git",
    ["cat-file", "--batch"],
    repositoryRoot,
    `${objectIds.join("\n")}\n`,
  );

  return {
    repositoryRoot,
    repository: basename(repositoryRoot),
    repositoryUrl,
    revision,
    ref,
    commits,
    blobs: parseBatch(batch, objectIds),
  };
}

function snapshotFor(
  blob: string | null,
  blobs: Map<string, string>,
  sha: string,
): DependencySnapshot {
  if (blob === null) return new Map();
  const content = blobs.get(blob);
  if (content === undefined) throw new Error(`missing package.json blob ${blob} at ${sha}`);
  return parsePackageJson(content, `package.json at ${sha.slice(0, 12)}`);
}

export async function createReport(
  cwd = process.cwd(),
  now: () => Temporal.Instant = () => Temporal.Now.instant(),
): Promise<{ report: Report; repositoryRoot: string; warnings: string[] }> {
  const history = await readHistory(cwd);
  const events: HistoryEvent[] = [];
  const warnings: string[] = [];

  for (const [traversalIndex, commit] of history.commits.entries()) {
    let previous: DependencySnapshot;
    let current: DependencySnapshot;
    try {
      previous = snapshotFor(commit.previousBlob, history.blobs, commit.sha);
      current = snapshotFor(commit.currentBlob, history.blobs, commit.sha);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    const changes = diffDependencies(previous, current);
    if (changes.length === 0) continue;

    let instant: Temporal.Instant;
    try {
      instant = Temporal.Instant.from(commit.committedAt);
    } catch {
      throw new Error(`commit ${commit.sha.slice(0, 12)} has an invalid timestamp`);
    }

    events.push({
      traversalIndex,
      changes,
      commit: {
        sha: commit.sha,
        subject: commit.subject,
        message: commit.message,
        authorName: commit.authorName,
        authorEmail: commit.authorEmail,
        committerName: commit.committerName,
        committedAt: instant.toString(),
        epochMilliseconds: Number(instant.epochMilliseconds),
        utcDate: instant.toZonedDateTimeISO("UTC").toPlainDate().toString(),
      },
    });
  }

  events.sort(
    (left, right) =>
      left.commit.epochMilliseconds - right.commit.epochMilliseconds ||
      left.traversalIndex - right.traversalIndex,
  );

  const totals = { commits: events.length, changes: 0, added: 0, updated: 0, removed: 0 };
  for (const event of events) {
    totals.changes += event.changes.length;
    for (const change of event.changes) totals[change.type]++;
  }

  return {
    repositoryRoot: history.repositoryRoot,
    warnings,
    report: {
      repository: history.repository,
      repositoryUrl: history.repositoryUrl,
      revision: history.revision,
      ref: history.ref,
      generatedAt: now().toString(),
      firstDate: events[0]?.commit.utcDate ?? null,
      lastDate: events.at(-1)?.commit.utcDate ?? null,
      totals,
      events,
    },
  };
}
