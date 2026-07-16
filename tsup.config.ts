import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "cli/index": "src/cli/index.ts",
    "web/main": "src/web/main.ts",
    "worker/main": "src/worker/main.ts",
    "db/maintenance-main": "src/db/maintenance-main.ts",
  },
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
