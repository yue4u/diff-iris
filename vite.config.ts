import { readFile } from "node:fs/promises";
import { defineConfig } from "vite-plus";

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

export default defineConfig({
  plugins: [rawAssets()],
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    entry: ["src/cli.ts"],
    platform: "node",
    dts: false,
    plugins: [rawAssets()],
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
