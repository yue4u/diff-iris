import { parseOwnershipArguments } from "./ownership/arguments.ts";
import { analyzeMatch, analyzeRank } from "./ownership/git.ts";
import { renderOwnership } from "./ownership/render.ts";

interface Output {
  write(chunk: string | Uint8Array): unknown;
}

interface OwnershipOptions {
  args: string[];
  cwd: string;
  stdout: Output;
  stderr: Output;
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

export async function runOwnership(options: OwnershipOptions): Promise<number> {
  if (options.args.includes("--help") || options.args.includes("-h")) {
    options.stdout.write(ownershipHelp);
    return 0;
  }
  try {
    const { format, jobs, pattern, patterns, rank } = parseOwnershipArguments(options.args);
    const report = rank
      ? await analyzeRank(options.cwd, jobs)
      : await analyzeMatch(options.cwd, jobs, pattern!, patterns);
    options.stdout.write(renderOwnership(report, format));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.stderr.write(`diff-iris: ${message}\n`);
    return 1;
  }
}
