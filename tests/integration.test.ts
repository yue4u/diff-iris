import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Temporal } from "temporal-polyfill-lite";
import { expect, test } from "vite-plus/test";
import { runCli } from "../src/cli.ts";
import { createReport } from "../src/git.ts";
import { renderReport } from "../src/report.ts";

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
