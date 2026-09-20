import { mkdirSync, writeFileSync } from "node:fs";
import { runMunicipalDiscovery } from "./municipal-discover.mjs";

if (process.argv.slice(2).some((arg) => arg !== "--dry-run")) throw new Error("usage: npm run municipal:discover [-- --dry-run]");
const report = await runMunicipalDiscovery();
mkdirSync(".wrangler", { recursive: true });
writeFileSync(".wrangler/municipal-discovery-dry-run.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ mode: report.mode, ...report.summary, output: ".wrangler/municipal-discovery-dry-run.json" }, null, 2));
