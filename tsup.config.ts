import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "cli/index": "src/cli/index.ts" },
  format: ["esm"],
  dts: false,
  shims: true,
  external: ["ink", "react"],
  clean: true,
  target: "es2024",
  sourcemap: true,
  splitting: false,
  metafile: true,
});
