import { describe, expect, test } from "vite-plus/test";
import { diffDependencies, parsePackageJson } from "../src/cli/manifest.ts";

describe("package.json dependencies", () => {
  test("parses the four supported dependency sections", () => {
    const snapshot = parsePackageJson(
      JSON.stringify({
        dependencies: { alpha: "^1.0.0" },
        devDependencies: { beta: "2.0.0" },
        peerDependencies: { gamma: ">=3" },
        optionalDependencies: { delta: "workspace:*" },
        scripts: { test: "ignored" },
      }),
    );

    expect([...snapshot.values()]).toEqual([
      { section: "dependencies", version: "^1.0.0" },
      { section: "devDependencies", version: "2.0.0" },
      { section: "peerDependencies", version: ">=3" },
      { section: "optionalDependencies", version: "workspace:*" },
    ]);
  });

  test("classifies additions, updates, removals, and section moves", () => {
    const previous = parsePackageJson(
      JSON.stringify({
        dependencies: { removed: "1", moved: "1", updated: "1" },
      }),
    );
    const current = parsePackageJson(
      JSON.stringify({
        dependencies: { added: "1", updated: "2" },
        devDependencies: { moved: "2" },
      }),
    );

    expect(diffDependencies(previous, current)).toEqual([
      { type: "added", name: "added", current: { section: "dependencies", version: "1" } },
      {
        type: "updated",
        name: "moved",
        previous: { section: "dependencies", version: "1" },
        current: { section: "devDependencies", version: "2" },
      },
      {
        type: "removed",
        name: "removed",
        previous: { section: "dependencies", version: "1" },
      },
      {
        type: "updated",
        name: "updated",
        previous: { section: "dependencies", version: "1" },
        current: { section: "dependencies", version: "2" },
      },
    ]);
  });

  test("does not collapse ambiguous duplicate section entries", () => {
    const previous = parsePackageJson(
      JSON.stringify({
        dependencies: { same: "1" },
        devDependencies: { same: "1" },
      }),
    );
    const current = parsePackageJson(JSON.stringify({ peerDependencies: { same: "2" } }));

    expect(diffDependencies(previous, current)).toEqual([
      {
        type: "added",
        name: "same",
        current: { section: "peerDependencies", version: "2" },
      },
      {
        type: "removed",
        name: "same",
        previous: { section: "dependencies", version: "1" },
      },
      {
        type: "removed",
        name: "same",
        previous: { section: "devDependencies", version: "1" },
      },
    ]);
  });

  test("reports invalid manifests with context", () => {
    expect(() => parsePackageJson("{", "package.json at abc")).toThrow(/package\.json at abc/);
    expect(() => parsePackageJson('{"dependencies":[]}', "historical manifest")).toThrow(
      "historical manifest field dependencies must be an object",
    );
    expect(() => parsePackageJson('{"dependencies":{"x":1}}')).toThrow(
      "package.json dependency dependencies.x must be a string",
    );
  });
});
