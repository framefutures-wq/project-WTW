import { defineConfig } from "@playwright/test";

const outputDir = process.env.TEST_OUTPUT_DIR ?? "test-results/ui-ci";

export default defineConfig({
  testDir: "./tests/browser",
  testIgnore: ["tourapi-real.spec.ts", "production-smoke.spec.ts"],
  outputDir,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:8787",
    trace: "retain-on-failure",
  },
  reporter: [
    ["list"],
    ["json", { outputFile: `${outputDir}/browser-report.json` }],
  ],
  webServer: {
    command: "npm run setup && npm run dev:sample",
    url: "http://127.0.0.1:8787",
    reuseExistingServer: false,
    timeout: 120000,
    stdout: "pipe",
    stderr: "pipe",
  },
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
