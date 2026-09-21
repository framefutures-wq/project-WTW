export const ALERT_TYPES = [
  "NEW_EVENT",
  "SCHEDULE_CHANGED",
  "CANCELLED_OR_POSTPONED",
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export type AlertCore = {
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
};

export function alertDedupeKey(type: AlertType, eventId: string, after: AlertCore) {
  if (type === "NEW_EVENT") return `new:${eventId}`;
  if (type === "SCHEDULE_CHANGED") return `schedule:${eventId}:${after.start_date ?? ""}:${after.end_date ?? ""}`;
  return `status:${eventId}:${after.status ?? ""}`;
}

export function alertId(dedupeKey: string) {
  return `alert-${dedupeKey}`;
}

export function scheduleChanged(before: AlertCore | null | undefined, after: AlertCore) {
  return Boolean(before && (before.start_date !== after.start_date || before.end_date !== after.end_date));
}

export function cancellationConfirmed(before: AlertCore | null | undefined, after: AlertCore) {
  return Boolean(before && after.status && ["cancelled", "postponed"].includes(after.status) && before.status !== after.status);
}
