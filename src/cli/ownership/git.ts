import { spawn } from "node:child_process";
import { gitError, runGit } from "../git/process.ts";
import type {
  RankedAuthor,
  OwnershipMetric as Metric,
  OwnershipReport,
} from "../../shared/ownership-types.ts";

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

interface HeadInventory {
  files: HeadFile[];
  lines: number;
}

async function headFiles(cwd: string): Promise<HeadFile[]> {
  const output = await runGit(["ls-tree", "-r", "-z", "HEAD"], cwd);
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
    await runGit(["commit-graph", "write", "--reachable", "--changed-paths", "--no-progress"], cwd);
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
      else reject(gitError(stderr, "git log failed"));
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

async function inspectHeadFiles(cwd: string, files: HeadFile[]): Promise<HeadInventory> {
  if (files.length === 0) return { files: [], lines: 0 };
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
  let fileIndex = 0;
  const textFiles: HeadFile[] = [];

  const finishBlob = (): void => {
    if (!binary) {
      textFiles.push(files[fileIndex]);
      total += newlines + (blobSize > 0 && lastByte !== 10 ? 1 : 0);
    }
    fileIndex++;
    remaining = undefined;
    skipSeparator = true;
  };

  child.stderr.on("data", (chunk: Uint8Array) => stderr.push(chunk));
  child.stdin.end(`${files.map((file) => file.objectId).join("\n")}\n`);
  const completed = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(gitError(stderr, "git cat-file failed"));
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
  if (fileIndex !== files.length) throw new Error("git cat-file returned too few blobs");
  return { files: textFiles, lines: total };
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
        reject(gitError(stderr, `git blame failed for ${path}`));
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

async function mapConcurrent<T>(
  files: HeadFile[],
  jobs: number,
  visit: (file: HeadFile) => Promise<T>,
  consume: (result: T) => void,
): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    while (next < files.length) consume(await visit(files[next++]));
  }
  await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, worker));
}

async function countOwnership(
  files: HeadFile[],
  jobs: number,
  check: (path: string) => Promise<BlameResult>,
): Promise<OwnershipCount> {
  let attributed = 0;
  let lines = 0;
  await mapConcurrent(
    files,
    jobs,
    (file) => check(file.path),
    (result) => {
      if (result.attributed) attributed++;
      lines += result.lines;
    },
  );
  return { files: attributed, lines };
}

async function countAuthors(
  cwd: string,
  files: HeadFile[],
  jobs: number,
  includedPaths: Promise<Set<string>>,
): Promise<Map<string, OwnershipCount>> {
  const totals = new Map<string, OwnershipCount>();
  await mapConcurrent(
    files,
    jobs,
    async (file) => ({
      authors: await blameAuthors(cwd, file.path),
      included: (await includedPaths).has(file.path),
    }),
    ({ authors, included }) => {
      if (!included) return;
      for (const [author, lines] of authors) {
        const total = totals.get(author) ?? { files: 0, lines: 0 };
        total.files++;
        total.lines += lines;
        totals.set(author, total);
      }
    },
  );
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

export async function analyzeRank(cwd: string, jobs: number): Promise<OwnershipReport> {
  const files = await headFiles(cwd);
  await prepareCommitGraph(cwd, files.length);
  const inventoryPromise = inspectHeadFiles(cwd, files);
  const includedPaths = inventoryPromise.then(
    (inventory) => new Set(inventory.files.map((file) => file.path)),
  );
  const [authors, inventory] = await Promise.all([
    countAuthors(cwd, files, jobs, includedPaths),
    inventoryPromise,
  ]);
  return {
    mode: "rank",
    authors: rankAuthors(authors, inventory.files.length, inventory.lines),
    files: inventory.files.length,
    lines: inventory.lines,
  };
}

export async function analyzeMatch(
  cwd: string,
  jobs: number,
  pattern: RegExp,
  patterns: string[],
): Promise<OwnershipReport> {
  const files = await headFiles(cwd);
  await prepareCommitGraph(cwd, files.length);
  const [candidates, inventory] = await Promise.all([
    candidateFiles(cwd, files, pattern),
    inspectHeadFiles(cwd, files),
  ]);
  const textPaths = new Set(inventory.files.map((file) => file.path));
  const ownership = await countOwnership(
    candidates.filter((file) => textPaths.has(file.path)),
    jobs,
    (path) => blameFile(cwd, path, pattern),
  );
  return {
    mode: "match",
    patterns,
    files: metric(ownership.files, inventory.files.length),
    lines: metric(ownership.lines, inventory.lines),
  };
}
