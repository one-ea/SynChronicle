import { describe, expect, it } from "vitest";
import { selectPlaywrightWebServer } from "./playwright-server.js";

describe("Playwright web server selection", () => {
  it("uses Vite for a responsive-only project run without PostgreSQL", () => {
    expect(selectPlaywrightWebServer(["node", "playwright", "test", "--project=responsive"], {})).toMatchObject({
      command: "pnpm exec vite --host 127.0.0.1 --port 4173",
      url: "http://127.0.0.1:4173/",
    });
  });

  it("uses the full-stack orchestrator when a full-stack project is selected", () => {
    expect(selectPlaywrightWebServer(["node", "playwright", "test", "--project", "fullstack-desktop"], {})).toMatchObject({
      command: "pnpm exec vite-node scripts/e2e-server.ts",
      url: "http://127.0.0.1:4173/api/health/ready",
    });
  });

  it("uses the full-stack orchestrator when CI runs every project", () => {
    expect(selectPlaywrightWebServer(["node", "playwright", "test"], { CI: "1" })).toMatchObject({
      command: "pnpm exec vite-node scripts/e2e-server.ts",
      url: "http://127.0.0.1:4173/api/health/ready",
    });
  });

  it("uses Vite for a responsive-only run even when PostgreSQL is available", () => {
    expect(selectPlaywrightWebServer(["node", "playwright", "test", "--project=responsive"], { TEST_DATABASE_URL: "postgres://test" })).toMatchObject({
      command: "pnpm exec vite --host 127.0.0.1 --port 4173",
      url: "http://127.0.0.1:4173/",
    });
  });

  it("does not let the responsive environment flag override an explicit full-stack project", () => {
    expect(selectPlaywrightWebServer(["node", "playwright", "test", "--project=fullstack-mobile"], { PLAYWRIGHT_RESPONSIVE_ONLY: "1" })).toMatchObject({
      command: "pnpm exec vite-node scripts/e2e-server.ts",
      url: "http://127.0.0.1:4173/api/health/ready",
    });
  });
});
