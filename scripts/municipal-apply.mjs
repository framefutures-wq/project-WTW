import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { validateApproval } from "../shared/municipal-approval.ts";
import { lookupMunicipalDuplicate } from "./municipal-duplicate-lookup.mjs";

const args = process.argv.slice(2); const value = (name) => args[args.indexOf(name) + 1];
const approve = value("--approve"); const fingerprint = value("--manifest");
if (!approve || !fingerprint) throw new Error("usage: npm run municipal:apply -- --approve <candidate-id[,candidate-id]> --manifest <fingerprint>");
const manifest = JSON.parse(readFileSync(".wrangler/municipal-discovery-dry-run.json", "utf8"));
const selected = validateApproval(manifest.candidates, fingerprint, manifest.fingerprint, approve.split(",").filter(Boolean));
function read(sql) { const result = spawnSync("npx", ["wrangler", "d1", "execute", "weekend-mwohae-production", "--remote", "--config", "wrangler.production.jsonc", "--json", "--command", sql], { encoding: "utf8" }); if (result.status) throw new Error(result.stderr || result.stdout); return JSON.parse(result.stdout)[0]; }
for (const candidate of selected) { const result = lookupMunicipalDuplicate({ id: candidate.candidate_id, title: candidate.title, region: "경기", start_date: candidate.start_date, end_date: candidate.end_date, venue: candidate.venue, address: candidate.venue }, read); if (result.decision !== "NEW") throw new Error(`apply blocked by current duplicate result: ${candidate.candidate_id}=${result.decision}`); }
throw new Error("apply validation passed, but production writer is intentionally disabled until Phase 10B-2 approval policy is implemented");
