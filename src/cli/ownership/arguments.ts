import { availableParallelism } from "node:os";
import { parseArgs } from "node:util";

export type OutputFormat = "text" | "json" | "html";

export interface OwnershipArguments {
  format: OutputFormat;
  jobs: number;
  pattern?: RegExp;
  patterns: string[];
  rank: boolean;
}

function positiveInteger(value: string | undefined, option: string): number {
  if (!value || !/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(`${option} requires a positive integer`);
  }
  return Number(value);
}

export function parseOwnershipArguments(args: string[]): OwnershipArguments {
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
    ? positiveInteger(values.jobs, "--jobs")
    : Math.min(32, Math.max(1, availableParallelism()));
  const rank = values.rank ?? false;
  if (rank && patterns.length > 0) {
    throw new Error("--rank cannot be combined with author patterns");
  }
  if (!rank && patterns.length === 0) {
    throw new Error("ownership requires an author pattern or --rank");
  }

  try {
    return {
      format,
      jobs,
      pattern: rank ? undefined : new RegExp(patterns.map((value) => `(?:${value})`).join("|")),
      patterns,
      rank,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid author pattern: ${detail}`);
  }
}
