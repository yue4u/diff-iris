import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { build, defineConfig } from "vite-plus";

function rawAssets() {
  return {
    name: "raw-assets",
    enforce: "pre" as const,
    async load(id: string) {
      if (!id.endsWith("?raw")) return;
      const content = await readFile(id.slice(0, -4), "utf8");
      return `export default ${JSON.stringify(content)};`;
    },
  };
}

function inlineReportClient() {
  const virtualId = "virtual:inline-report-client";
  const resolvedVirtualId = `\0${virtualId}`;
  return {
    name: "inline-report-client",
    resolveId(id: string) {
      if (id === virtualId) return resolvedVirtualId;
    },
    async load(id: string) {
      if (id !== resolvedVirtualId) return;
      const result = await build({
        configFile: false,
        define: {
          "process.env.NODE_ENV": JSON.stringify("production"),
        },
        logLevel: "silent",
        mode: "production",
        plugins: [vue()],
        build: {
          write: false,
          lib: {
            entry: resolve("src/browser/client.ts"),
            formats: ["iife"],
            name: "DiffIrisReport",
          },
        },
      });
      const builds = Array.isArray(result) ? result : [result];
      const outputs = builds.flatMap((buildResult) => {
        if ("output" in buildResult) return buildResult.output;
        throw new Error("report client build unexpectedly entered watch mode");
      });
      const chunk = outputs.find((output) => output.type === "chunk");
      if (!chunk || chunk.type !== "chunk") throw new Error("report client bundle was not emitted");
      return `export default ${JSON.stringify(chunk.code)};`;
    },
  };
}

export default defineConfig({
  plugins: [rawAssets(), inlineReportClient()],
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    entry: ["src/cli/cli.ts"],
    platform: "node",
    dts: false,
    plugins: [rawAssets(), inlineReportClient()],
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
  fmt: {},
});
