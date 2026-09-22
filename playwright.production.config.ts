import { defineConfig } from "@playwright/test";

const baseURL = process.env.TEST_BASE_URL;
if (!baseURL) {
  throw new Error("TEST_BASE_URL is required for production browser verification.");
}

const outputDir = process.env.TEST_OUTPUT_DIR ?? "test-results/production";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "production-smoke.spec.ts",
  outputDir,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  reporter: [
    ["list"],
    ["json", { outputFile: `${outputDir}/browser-report.json` }],
  ],
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
