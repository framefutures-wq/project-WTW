export type AuditOccurrence = {
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  venue: string | null;
};

export type AuditProgram = {
  name: string;
  occurrences: AuditOccurrence[];
  venue: string | null;
};

export type AuditSnapshot = {
  summary: string | null;
  operatingHours: AuditOccurrence[];
  programs: AuditProgram[];
};

export type ExpectedProgram = {
  name: string;
  required?: boolean;
  occurrences?: AuditOccurrence[];
  venue?: string | null;
};

export type ExpectedEventDetail = {
  summaryRequired: boolean;
  operatingHours?: AuditOccurrence[];
  programs?: ExpectedProgram[];
  allowAdditionalPrograms?: boolean;
};

export type CompletenessFinding = {
  kind:
    | "extraction_omission"
    | "unsupported_data"
    | "wrong_date"
    | "wrong_time"
    | "wrong_venue";
  field: string;
  expected?: string;
  actual?: string;
};

const occurrenceKey = (value: AuditOccurrence) =>
  [
    value.startDate,
    value.endDate,
    value.startTime ?? "",
    value.endTime ?? "",
    value.venue ?? "",
  ].join("|");

const programByName = (programs: AuditProgram[], name: string) =>
  programs.find((program) => program.name === name);

function compareOccurrences(
  field: string,
  expected: AuditOccurrence[],
  actual: AuditOccurrence[],
): CompletenessFinding[] {
  const findings: CompletenessFinding[] = [];
  const expectedKeys = new Set(expected.map(occurrenceKey));
  const actualKeys = new Set(actual.map(occurrenceKey));
  for (const value of expected) {
    const exact = occurrenceKey(value);
    if (actualKeys.has(exact)) continue;
    const sameDate = actual.find(
      (candidate) =>
        candidate.startDate === value.startDate &&
        candidate.endDate === value.endDate,
    );
    if (!sameDate) {
      findings.push({ kind: "extraction_omission", field, expected: exact });
      continue;
    }
    if (
      sameDate.startTime !== value.startTime ||
      sameDate.endTime !== value.endTime
    )
      findings.push({
        kind: "wrong_time",
        field,
        expected: exact,
        actual: occurrenceKey(sameDate),
      });
    else if (sameDate.venue !== value.venue)
      findings.push({
        kind: "wrong_venue",
        field,
        expected: exact,
        actual: occurrenceKey(sameDate),
      });
  }
  for (const value of actual) {
    if (!expectedKeys.has(occurrenceKey(value)))
      findings.push({
        kind: "unsupported_data",
        field,
        actual: occurrenceKey(value),
      });
  }
  return findings;
}

export function auditEventDetail(
  expected: ExpectedEventDetail,
  actual: AuditSnapshot,
): CompletenessFinding[] {
  const findings: CompletenessFinding[] = [];
  if (expected.summaryRequired && !actual.summary)
    findings.push({ kind: "extraction_omission", field: "summary" });
  if (!expected.summaryRequired && actual.summary)
    findings.push({
      kind: "unsupported_data",
      field: "summary",
      actual: actual.summary,
    });

  if (expected.operatingHours)
    findings.push(
      ...compareOccurrences(
        "operating_hours",
        expected.operatingHours,
        actual.operatingHours,
      ),
    );
  else if (actual.operatingHours.length)
    findings.push({ kind: "unsupported_data", field: "operating_hours" });

  for (const expectedProgram of expected.programs ?? []) {
    const program = programByName(actual.programs, expectedProgram.name);
    if (!program) {
      if (expectedProgram.required !== false)
        findings.push({
          kind: "extraction_omission",
          field: `program:${expectedProgram.name}`,
        });
      continue;
    }
    if (
      expectedProgram.venue !== undefined &&
      program.venue !== expectedProgram.venue
    )
      findings.push({
        kind: "wrong_venue",
        field: `program:${expectedProgram.name}:venue`,
        expected: expectedProgram.venue ?? "",
        actual: program.venue ?? "",
      });
    if (expectedProgram.occurrences)
      findings.push(
        ...compareOccurrences(
          `program:${expectedProgram.name}:occurrences`,
          expectedProgram.occurrences,
          program.occurrences,
        ),
      );
  }
  if (!expected.allowAdditionalPrograms) {
    const expectedNames = new Set(
      (expected.programs ?? []).map(({ name }) => name),
    );
    for (const program of actual.programs) {
      if (!expectedNames.has(program.name))
        findings.push({
          kind: "unsupported_data",
          field: `program:${program.name}`,
        });
    }
  }
  return findings;
}
