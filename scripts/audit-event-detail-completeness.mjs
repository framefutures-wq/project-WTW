import { readFileSync } from "node:fs";
import { auditEventDetail } from "../shared/event-detail-completeness-audit.ts";

const manifestPath =
  process.argv[2] ?? "fixtures/event-detail-completeness-v1.json";
const snapshotPath = process.argv[3];
if (!snapshotPath) {
  console.error(
    "Usage: npm run audit:event-detail-completeness -- <manifest.json> <bounded-snapshot.json>",
  );
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
const byId = new Map(snapshot.events.map((event) => [event.id, event]));
const results = manifest.events.map((event) => {
  const actual = byId.get(event.id) ?? {
    summary: null,
    operatingHours: [],
    programs: [],
  };
  const findings = auditEventDetail(event.expected, actual);
  return { id: event.id, title: event.title, findings };
});
const totals = Object.fromEntries(
  [
    "extraction_omission",
    "unsupported_data",
    "wrong_date",
    "wrong_time",
    "wrong_venue",
  ].map((kind) => [
    kind,
    results
      .flatMap((result) => result.findings)
      .filter((finding) => finding.kind === kind).length,
  ]),
);
console.log(
  JSON.stringify(
    { auditDate: manifest.auditDate, targets: results.length, totals, results },
    null,
    2,
  ),
);
