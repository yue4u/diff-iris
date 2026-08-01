import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Temporal } from "temporal-polyfill-lite";
import { expect, test } from "vite-plus/test";
import { runCli } from "../src/cli/cli.ts";
import { createReport } from "../src/cli/git.ts";
import { renderReport } from "../src/cli/report.ts";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commit(
  cwd: string,
  subject: string,
  body?: string,
  date = "2020-01-01T00:00:00Z",
): string {
  git(cwd, "add", "-A");
  const args = ["commit", "-m", subject];
  if (body) args.push("-m", body);
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    },
  });
  return git(cwd, "rev-parse", "HEAD");
}

function createRepository(): string {
  const directory = mkdtempSync(join(tmpdir(), "diff-iris-test-"));
  git(directory, "init", "--initial-branch=main");
  git(directory, "config", "user.name", "Test Author");
  git(directory, "config", "user.email", "author@example.test");
  git(directory, "config", "commit.gpgsign", "false");
  git(directory, "remote", "add", "origin", "git@github.com:example/fixture.git");
  return directory;
}

function commitAs(cwd: string, name: string, email: string, subject: string): void {
  git(cwd, "add", "-A");
  execFileSync("git", ["commit", "-m", subject], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: name,
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: "Merge Operator",
      GIT_COMMITTER_EMAIL: "merge@example.test",
    },
  });
}

test("collects reachable non-merge changes and full commit messages", async () => {
  const directory = createRepository();
  writeFileSync(join(directory, "package.json"), '{"dependencies":{"alpha":"1"}}');
  commit(directory, "Add alpha");

  git(directory, "checkout", "-b", "feature");
  writeFileSync(join(directory, "package.json"), '{"devDependencies":{"alpha":"2"}}');
  const featureSha = commit(
    directory,
    "Move alpha",
    "A multiline body.\n\nWith another paragraph.",
  );

  git(directory, "checkout", "main");
  writeFileSync(join(directory, "README.md"), "main branch\n");
  commit(directory, "Document main");
  git(directory, "merge", "--no-ff", "feature", "-m", "Merge feature");
  const nested = join(directory, "nested");
  mkdirSync(nested);

  const { report, repositoryRoot } = await createReport(nested, () =>
    Temporal.Instant.from("2026-01-01T00:00:00Z"),
  );

  expect(repositoryRoot).toBe(directory);
  expect(report.generatedAt).toBe("2026-01-01T00:00:00Z");
  expect(report.totals).toEqual({ commits: 2, changes: 2, added: 1, updated: 1, removed: 0 });
  const feature = report.events.find((event) => event.commit.sha === featureSha);
  expect(feature?.commit.message).toContain("A multiline body.\n\nWith another paragraph.");
  expect(feature?.changes).toEqual([
    {
      type: "updated",
      name: "alpha",
      previous: { section: "dependencies", version: "1" },
      current: { section: "devDependencies", version: "2" },
    },
  ]);
  expect(report.events.some((event) => event.commit.subject === "Merge feature")).toBe(false);
});

test("renders an offline document and escapes untrusted report data", async () => {
  const directory = createRepository();
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({ dependencies: { "</script><img src=x onerror=alert(1)>": "1" } }),
  );
  commit(directory, "Unsafe </script>", "Body <b>must remain text</b>");
  const { report } = await createReport(directory, () =>
    Temporal.Instant.from("2026-01-01T00:00:00Z"),
  );
  report.repository = "fixture";
  expect(renderReport(report)).toMatchSnapshot();
});

test("normalizes SemVer ranges for updated-package grouping", async () => {
  const directory = createRepository();
  writeFileSync(
    join(directory, "package.json"),
    '{"dependencies":{"alpha":"^6.1.0","local":"workspace:"}}',
  );
  commit(directory, "Add dependencies");
  writeFileSync(
    join(directory, "package.json"),
    '{"dependencies":{"alpha":"^9.6.1","local":"workspace:*"}}',
  );
  commit(directory, "Update dependencies");

  const { report } = await createReport(directory);
  const html = renderReport(report);
  const start = html.indexOf('<script id="report-data" type="application/json">');
  const contentStart = html.indexOf(">", start) + 1;
  const end = html.indexOf("</script>", contentStart);
  const clientReport = JSON.parse(html.slice(contentStart, end));

  expect(clientReport.semver).toMatchObject({
    "^6.1.0": [6, 1, 0],
    "^9.6.1": [9, 6, 1],
    "workspace:": null,
    "workspace:*": null,
  });
});

test("warns and continues past invalid historical manifests", async () => {
  const directory = createRepository();
  writeFileSync(join(directory, "package.json"), '{"dependencies":{"alpha":"1"}}');
  commit(directory, "Add alpha");
  writeFileSync(join(directory, "package.json"), "{ conflict markers");
  const invalidSha = commit(directory, "Commit invalid manifest");
  writeFileSync(join(directory, "package.json"), '{"dependencies":{"alpha":"2"}}');
  commit(directory, "Repair manifest");
  writeFileSync(join(directory, "package.json"), '{"dependencies":{"alpha":"2","beta":"1"}}');
  commit(directory, "Add beta");

  const { report, warnings } = await createReport(directory);
  expect(report.events.map((event) => event.commit.subject)).toEqual(["Add alpha", "Add beta"]);
  expect(warnings).toHaveLength(2);
  expect(warnings[0]).toContain(invalidSha.slice(0, 12));
});

test("routes redirected output and TTY output separately", async () => {
  const directory = createRepository();
  writeFileSync(join(directory, "package.json"), '{"dependencies":{"alpha":"1"}}');
  commit(directory, "Add alpha");
  let stdout = "";
  let stderr = "";
  const sink = (target: "out" | "err") => ({
    write(chunk: string | Uint8Array) {
      const value = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      if (target === "out") stdout += value;
      else stderr += value;
      return true;
    },
  });

  expect(
    await runCli({ cwd: directory, isTTY: false, stdout: sink("out"), stderr: sink("err") }),
  ).toBe(0);
  expect(stdout.startsWith("<!doctype html>")).toBe(true);
  expect(stderr).toBe("");

  stdout = "";
  expect(
    await runCli({ cwd: directory, isTTY: true, stdout: sink("out"), stderr: sink("err") }),
  ).toBe(0);
  expect(stdout).toBe("");
  expect(stderr).toContain(".diff-iris/index.html");
  expect(
    readFileSync(join(directory, ".diff-iris", "index.html"), "utf8").startsWith("<!doctype html>"),
  ).toBe(true);
});

test("filters the generated report with inclusive UTC CLI dates", async () => {
  const directory = createRepository();
  writeFileSync(join(directory, "package.json"), '{"dependencies":{"alpha":"1"}}');
  commit(directory, "Add alpha", undefined, "2020-01-01T12:00:00Z");
  writeFileSync(join(directory, "package.json"), '{"dependencies":{"alpha":"1","beta":"1"}}');
  commit(directory, "Add beta", undefined, "2020-02-01T12:00:00Z");
  let stdout = "";
  let stderr = "";
  const output = {
    write(chunk: string | Uint8Array) {
      stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    },
  };
  const errors = {
    write(chunk: string | Uint8Array) {
      stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    },
  };

  expect(
    await runCli({
      args: ["--since=2020-02-01", "--until", "2020-02-01"],
      cwd: directory,
      isTTY: false,
      stdout: output,
      stderr: errors,
    }),
  ).toBe(0);
  const start = stdout.indexOf('<script id="report-data" type="application/json">');
  const contentStart = stdout.indexOf(">", start) + 1;
  const end = stdout.indexOf("</script>", contentStart);
  const report = JSON.parse(stdout.slice(contentStart, end));
  expect(
    report.events.map((event: { commit: { subject: string } }) => event.commit.subject),
  ).toEqual(["Add beta"]);
  expect(report.totals).toEqual({ commits: 1, changes: 1, added: 1, updated: 0, removed: 0 });
  expect(stderr).toBe("");
});

test("reports missing repository context and unsupported arguments", async () => {
  let stderr = "";
  const sink = {
    write(chunk: string | Uint8Array) {
      stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    },
  };
  expect(await runCli({ cwd: tmpdir(), isTTY: false, stderr: sink })).toBe(1);
  expect(stderr).toContain("inside a Git repository");

  stderr = "";
  expect(await runCli({ args: ["--unknown"], isTTY: false, stderr: sink })).toBe(1);
  expect(stderr).toContain("unsupported argument");

  stderr = "";
  expect(
    await runCli({
      args: ["--since", "2020-02-30"],
      isTTY: false,
      stderr: sink,
    }),
  ).toBe(1);
  expect(stderr).toContain("not a valid calendar date");

  stderr = "";
  expect(
    await runCli({
      args: ["--since", "2021-01-01", "--until", "2020-01-01"],
      isTTY: false,
      stderr: sink,
    }),
  ).toBe(1);
  expect(stderr).toContain("must not be after");
});

test("counts HEAD files with surviving lines by matching authors", async () => {
  const directory = createRepository();
  writeFileSync(join(directory, "alice.txt"), "Alice owns this file.\n");
  writeFileSync(join(directory, "shared.txt"), "Alice line.\n");
  commitAs(directory, "Alice Example", "alice@example.test", "Add Alice files");
  git(directory, "mv", "alice.txt", "renamed-alice.txt");
  writeFileSync(join(directory, "bob.txt"), "Bob owns this file.\n");
  writeFileSync(join(directory, "shared.txt"), "Alice line.\nBob line.\n");
  commitAs(directory, "Bob Example", "bob@example.test", "Add Bob lines");

  let stdout = "";
  let stderr = "";
  const output = {
    write(chunk: string | Uint8Array) {
      stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    },
  };
  const errors = {
    write(chunk: string | Uint8Array) {
      stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    },
  };

  expect(
    await runCli({
      args: ["ownership", "Alice Example", "--jobs", "2"],
      cwd: directory,
      stdout: output,
      stderr: errors,
    }),
  ).toBe(0);
  expect(stdout).toBe(
    "2 / 3 files (66.67%) and 2 / 4 lines (50.00%) are attributed to Alice Example\n",
  );
  expect(stderr).toBe("");

  stdout = "";
  expect(
    await runCli({
      args: ["ownership", "Alice|Bob"],
      cwd: directory,
      stdout: output,
      stderr: errors,
    }),
  ).toBe(0);
  expect(stdout).toBe(
    "3 / 3 files (100.00%) and 4 / 4 lines (100.00%) are attributed to Alice|Bob\n",
  );

  stdout = "";
  expect(
    await runCli({
      args: ["ownership", "--rank", "--jobs=2"],
      cwd: directory,
      stdout: output,
      stderr: errors,
    }),
  ).toBe(0);
  expect(stdout).toBe(
    "1. Alice Example — 2 / 3 files (66.67%) · 2 / 4 lines (50.00%)\n" +
      "2. Bob Example — 2 / 3 files (66.67%) · 2 / 4 lines (50.00%)\n",
  );

  stdout = "";
  expect(
    await runCli({
      args: ["ownership", "--rank", "--format=json", "--jobs=2"],
      cwd: directory,
      stdout: output,
      stderr: errors,
    }),
  ).toBe(0);
  expect(JSON.parse(stdout)).toEqual({
    mode: "rank",
    authors: [
      {
        author: "Alice Example",
        files: { count: 2, percentage: 66.67, total: 3 },
        lines: { count: 2, percentage: 50, total: 4 },
        rank: 1,
      },
      {
        author: "Bob Example",
        files: { count: 2, percentage: 66.67, total: 3 },
        lines: { count: 2, percentage: 50, total: 4 },
        rank: 2,
      },
    ],
    files: 3,
    lines: 4,
  });

  stdout = "";
  expect(
    await runCli({
      args: ["ownership", "--rank", "--format", "html", "--jobs=2"],
      cwd: directory,
      stdout: output,
      stderr: errors,
    }),
  ).toBe(0);
  expect(stdout.startsWith("<!doctype html>")).toBe(true);
  expect(stdout).toContain('<div id="ownership-app"></div>');
  expect(stdout).toContain('<script id="ownership-data" type="application/json">');
  expect(stdout).toContain("Alice Example");

  stderr = "";
  expect(
    await runCli({
      args: ["ownership", "["],
      cwd: directory,
      stdout: output,
      stderr: errors,
    }),
  ).toBe(1);
  expect(stderr).toContain("invalid author pattern");

  stderr = "";
  expect(
    await runCli({
      args: ["ownership", "--rank", "Alice"],
      cwd: directory,
      stdout: output,
      stderr: errors,
    }),
  ).toBe(1);
  expect(stderr).toContain("cannot be combined");

  stderr = "";
  expect(
    await runCli({
      args: ["ownership", "Alice", "--format", "xml"],
      cwd: directory,
      stdout: output,
      stderr: errors,
    }),
  ).toBe(1);
  expect(stderr).toContain("text, json, or html");
});
