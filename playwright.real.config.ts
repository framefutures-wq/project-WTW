import { defineConfig } from "@playwright/test";
import original from "./playwright.config";
export default defineConfig({
  ...original,
  testIgnore: [],
  testMatch: "tourapi-real.spec.ts",
  outputDir: process.env.TEST_OUTPUT_DIR ?? "test-results/real",
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: `${process.env.TEST_OUTPUT_DIR ?? "test-results/real"}/browser-report.json`,
      },
    ],
  ],
});
