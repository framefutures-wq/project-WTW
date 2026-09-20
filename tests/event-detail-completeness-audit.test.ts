import assert from "node:assert/strict";
import test from "node:test";
import { auditEventDetail } from "../shared/event-detail-completeness-audit";

const occurrence = {
  startDate: "2026-09-20",
  endDate: "2026-09-20",
  startTime: "20:30",
  endTime: null,
  venue: "한울광장",
};

test("completeness audit accepts exact official program occurrences", () => {
  assert.deepEqual(
    auditEventDetail(
      {
        summaryRequired: true,
        programs: [{ name: "불꽃", occurrences: [occurrence] }],
      },
      {
        summary: "공식 요약",
        operatingHours: [],
        programs: [{ name: "불꽃", venue: null, occurrences: [occurrence] }],
      },
    ),
    [],
  );
});

test("completeness audit separates missing and unsupported program data", () => {
  const findings = auditEventDetail(
    {
      summaryRequired: true,
      programs: [{ name: "불꽃", occurrences: [occurrence] }],
    },
    {
      summary: null,
      operatingHours: [],
      programs: [
        {
          name: "불꽃",
          venue: null,
          occurrences: [
            { ...occurrence, startDate: "2026-09-19", endDate: "2026-09-19" },
          ],
        },
      ],
    },
  );
  assert.equal(
    findings.some(
      (finding) =>
        finding.field === "summary" && finding.kind === "extraction_omission",
    ),
    true,
  );
  assert.equal(
    findings.some(
      (finding) =>
        finding.kind === "extraction_omission" &&
        finding.field.includes("occurrences"),
    ),
    true,
  );
  assert.equal(
    findings.some((finding) => finding.kind === "unsupported_data"),
    true,
  );
});

test("program-only times cannot satisfy event-wide operating hours", () => {
  const findings = auditEventDetail(
    { summaryRequired: false },
    { summary: null, operatingHours: [occurrence], programs: [] },
  );
  assert.deepEqual(findings, [
    { kind: "unsupported_data", field: "operating_hours" },
  ]);
});

test("completeness audit reports an unmanifested program as unsupported", () => {
  const findings = auditEventDetail(
    { summaryRequired: false, programs: [] },
    {
      summary: null,
      operatingHours: [],
      programs: [{ name: "근거 없는 프로그램", venue: null, occurrences: [] }],
    },
  );
  assert.deepEqual(findings, [
    { kind: "unsupported_data", field: "program:근거 없는 프로그램" },
  ]);
});
