import { defineConfig } from "@playwright/test";
const outputDir = process.env.TEST_OUTPUT_DIR ?? "test-results";
export default defineConfig({
  testDir: "./tests/browser",
  outputDir,
  use: {
    baseURL: process.env.TEST_BASE_URL ?? "http://127.0.0.1:8787",
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
