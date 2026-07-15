import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backendUrl = process.env.VITE_BACKEND_URL ?? "http://localhost:3000";
const websocketUrl = backendUrl.replace(/^http/, "ws");

export default defineConfig({
  plugins: [react()],
  root: ".",
  build: {
    outDir: "dist/web/client",
    emptyOutDir: false,
  },
  server: {
    allowedHosts: [".monkeycode-ai.online"],
    proxy: {
      "/api": { target: backendUrl, changeOrigin: true },
      "/ws": { target: websocketUrl, ws: true },
    },
  },
});
