import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  projects: [
    { name: "responsive", testMatch: "tests/browser/**/*.spec.ts", use: { ...devices["Desktop Chrome"] } },
    { name: "fullstack-desktop", testMatch: "e2e/**/*.spec.ts", use: { ...devices["Desktop Chrome"] } },
    { name: "fullstack-mobile", testMatch: "e2e/**/*.spec.ts", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "pnpm exec vite-node scripts/e2e-server.ts",
    url: "http://127.0.0.1:4173/api/health/ready",
    timeout: 120_000,
    reuseExistingServer: false,
    env: { ...process.env, TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? "" },
  },
});
