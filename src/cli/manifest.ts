import {
  dependencySections,
  type DependencyChange,
  type DependencyLocation,
  type DependencySection,
} from "../shared/types.ts";

export type DependencySnapshot = Map<string, DependencyLocation>;

function snapshotKey(section: DependencySection, name: string): string {
  return `${section}\0${name}`;
}

export function parsePackageJson(content: string, context = "package.json"): DependencySnapshot {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${context} contains invalid JSON: ${detail}`);
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must contain a JSON object`);
  }

  const manifest = value as Record<string, unknown>;
  const snapshot: DependencySnapshot = new Map();

  for (const section of dependencySections) {
    const dependencies = manifest[section];
    if (dependencies === undefined) continue;
    if (dependencies === null || typeof dependencies !== "object" || Array.isArray(dependencies)) {
      throw new Error(`${context} field ${section} must be an object`);
    }

    for (const [name, version] of Object.entries(dependencies)) {
      if (typeof version !== "string") {
        throw new Error(`${context} dependency ${section}.${name} must be a string`);
      }
      snapshot.set(snapshotKey(section, name), { section, version });
    }
  }

  return snapshot;
}

function packageName(key: string): string {
  return key.slice(key.indexOf("\0") + 1);
}

function compareChanges(left: DependencyChange, right: DependencyChange): number {
  return (
    left.name.localeCompare(right.name) ||
    left.type.localeCompare(right.type) ||
    (left.current?.section ?? left.previous?.section ?? "").localeCompare(
      right.current?.section ?? right.previous?.section ?? "",
    )
  );
}

export function diffDependencies(
  previous: DependencySnapshot,
  current: DependencySnapshot,
): DependencyChange[] {
  const changes: DependencyChange[] = [];
  const unmatchedPrevious = new Map(previous);
  const unmatchedCurrent = new Map(current);

  for (const [key, before] of previous) {
    const after = current.get(key);
    if (!after) continue;

    unmatchedPrevious.delete(key);
    unmatchedCurrent.delete(key);
    if (before.version !== after.version) {
      changes.push({
        type: "updated",
        name: packageName(key),
        previous: before,
        current: after,
      });
    }
  }

  const previousByName = new Map<string, Array<[string, DependencyLocation]>>();
  const currentByName = new Map<string, Array<[string, DependencyLocation]>>();

  for (const entry of unmatchedPrevious) {
    const name = packageName(entry[0]);
    const entries = previousByName.get(name) ?? [];
    entries.push(entry);
    previousByName.set(name, entries);
  }
  for (const entry of unmatchedCurrent) {
    const name = packageName(entry[0]);
    const entries = currentByName.get(name) ?? [];
    entries.push(entry);
    currentByName.set(name, entries);
  }

  for (const [name, beforeEntries] of previousByName) {
    const afterEntries = currentByName.get(name);
    if (beforeEntries.length !== 1 || afterEntries?.length !== 1) continue;

    const [beforeKey, before] = beforeEntries[0];
    const [afterKey, after] = afterEntries[0];
    unmatchedPrevious.delete(beforeKey);
    unmatchedCurrent.delete(afterKey);
    changes.push({ type: "updated", name, previous: before, current: after });
  }

  for (const [key, before] of unmatchedPrevious) {
    changes.push({ type: "removed", name: packageName(key), previous: before });
  }
  for (const [key, after] of unmatchedCurrent) {
    changes.push({ type: "added", name: packageName(key), current: after });
  }

  return changes.sort(compareChanges);
}
