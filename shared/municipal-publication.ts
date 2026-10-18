type ExistingMunicipalEvent = { id: string } | null | undefined;

/**
 * A re-observed verified event may be written again for safety, but it does
 * not consume the bounded daily mutation budget unless its publication
 * payload is new or changed.
 */
export function isMunicipalPublicationMutation({
  existing,
  previousPayloadHash,
  payloadHash,
}: {
  existing: ExistingMunicipalEvent;
  previousPayloadHash: string | null | undefined;
  payloadHash: string;
}): boolean {
  return !existing || !previousPayloadHash || previousPayloadHash !== payloadHash;
}

export function municipalPublishSlotAvailable({
  publishMutations,
  isMutation,
  maxPublish,
}: {
  publishMutations: number;
  isMutation: boolean;
  maxPublish: number;
}): boolean {
  return !isMutation || publishMutations < maxPublish;
}


const seoulCalendarDay = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

/**
 * Existing municipal date/venue changes require the same payload to be
 * observed again on a later Korea calendar day. Re-running the same shard
 * on the same day must never count as the second confirmation.
 */
export function hasUnconfirmedMunicipalCoreChange({
  changedExisting,
  previousPayloadHash,
  payloadHash,
  previousSeenAt,
  currentSeenAt,
}: {
  changedExisting: boolean;
  previousPayloadHash: string | null | undefined;
  payloadHash: string;
  previousSeenAt: string | null | undefined;
  currentSeenAt: string;
}) {
  if (!changedExisting) return false;
  if (!previousPayloadHash || previousPayloadHash !== payloadHash)
    return true;

  const previousDay = seoulCalendarDay(previousSeenAt);
  const currentDay = seoulCalendarDay(currentSeenAt);
  if (!previousDay || !currentDay) return true;
  return previousDay >= currentDay;
}
