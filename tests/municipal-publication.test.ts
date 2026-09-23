import assert from "node:assert/strict";
import test from "node:test";
import {
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
