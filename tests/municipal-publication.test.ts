import assert from "node:assert/strict";
import test from "node:test";
import {
  hasUnconfirmedMunicipalCoreChange,
  isMunicipalPublicationMutation,
  municipalPublishSlotAvailable,
} from "../shared/municipal-publication";

const unchanged = {
  existing: { id: "municipal-existing" },
  previousPayloadHash: "same",
  payloadHash: "same",
};

test("only new or changed municipal publication payloads consume the daily cap", () => {
  assert.equal(isMunicipalPublicationMutation(unchanged), false);
  assert.equal(
    isMunicipalPublicationMutation({ ...unchanged, existing: null }),
    true,
  );
  assert.equal(
    isMunicipalPublicationMutation({
      ...unchanged,
      previousPayloadHash: "old",
    }),
    true,
  );
  assert.equal(
    isMunicipalPublicationMutation({
      ...unchanged,
      previousPayloadHash: null,
    }),
    true,
  );
});

test("unchanged revalidation cannot starve later municipal mutations", () => {
  const maxPublish = 10;
  let publishMutations = 0;
  for (let index = 0; index < 10; index += 1) {
    const isMutation = isMunicipalPublicationMutation(unchanged);
    assert.equal(
      municipalPublishSlotAvailable({
        publishMutations,
        isMutation,
        maxPublish,
      }),
      true,
    );
    if (isMutation) publishMutations += 1;
  }
  assert.equal(publishMutations, 0);
  assert.equal(
    municipalPublishSlotAvailable({
      publishMutations,
      isMutation: true,
      maxPublish,
    }),
    true,
  );
  publishMutations += 1;
  while (publishMutations < maxPublish) {
    assert.equal(
      municipalPublishSlotAvailable({
        publishMutations,
        isMutation: true,
        maxPublish,
      }),
      true,
    );
    publishMutations += 1;
  }
  assert.equal(
    municipalPublishSlotAvailable({
      publishMutations: maxPublish,
      isMutation: true,
      maxPublish,
    }),
    false,
  );
});


test("municipal core changes require an identical observation on a later Korea day", () => {
  const base = {
    changedExisting: true,
    previousPayloadHash: "same",
    payloadHash: "same",
  };

  assert.equal(
    hasUnconfirmedMunicipalCoreChange({
      ...base,
      previousSeenAt: "2026-09-27T01:00:00.000Z",
      currentSeenAt: "2026-09-27T05:00:00.000Z",
    }),
    true,
  );

  assert.equal(
    hasUnconfirmedMunicipalCoreChange({
      ...base,
      previousSeenAt: "2026-09-27T01:00:00.000Z",
      currentSeenAt: "2026-09-27T15:10:00.000Z",
    }),
    false,
  );

  assert.equal(
    hasUnconfirmedMunicipalCoreChange({
      ...base,
      previousPayloadHash: "old",
      previousSeenAt: "2026-09-26T01:00:00.000Z",
      currentSeenAt: "2026-09-27T01:00:00.000Z",
    }),
    true,
  );

  assert.equal(
    hasUnconfirmedMunicipalCoreChange({
      ...base,
      changedExisting: false,
      previousSeenAt: null,
      currentSeenAt: "2026-09-27T01:00:00.000Z",
    }),
    false,
  );
});
