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
