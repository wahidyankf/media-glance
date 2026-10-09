import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test/browser",
  testMatch: "viewer.spec.mjs",
  workers: 1,
  timeout: 120000,
  use: { browserName: "chromium", headless: true },
});
