import { spawn } from "node:child_process";

const decoder = new TextDecoder();

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function gitError(stderr: Uint8Array[], fallback: string): Error {
  return new Error(decoder.decode(concatBytes(stderr)).trim() || fallback);
}

export function runGit(args: string[], cwd: string, input?: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    child.stdout.on("data", (chunk: Uint8Array) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Uint8Array) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(concatBytes(stdout));
      else reject(gitError(stderr, `git exited with status ${String(code)}`));
    });
    child.stdin.end(input);
  });
}

export async function gitText(args: string[], cwd: string): Promise<string> {
  return decoder.decode(await runGit(args, cwd)).trim();
}
