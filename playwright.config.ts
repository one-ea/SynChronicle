import { defineConfig, devices } from "@playwright/test";
import { selectPlaywrightWebServer } from "./scripts/playwright-server.js";

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
  webServer: selectPlaywrightWebServer(process.argv, process.env),
});
