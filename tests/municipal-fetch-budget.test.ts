import assert from "node:assert/strict";
import test from "node:test";
import {
  MUNICIPAL_MAX_FETCHES_PER_SOURCE_WINDOW,
  MUNICIPAL_MIN_FETCH_RESERVE_PER_SOURCE,
  municipalSourceFetchCeiling,
} from "../shared/municipal-fetch-budget";

test("municipal fetch windows reserve two attempts for every later source", () => {
  const hardLimit = 35;
  let used = 0;
  const sourceCount = 12;
  const ceilings: number[] = [];

  for (let index = 0; index < sourceCount; index += 1) {
    const ceiling = municipalSourceFetchCeiling({
      used,
      hardLimit,
      remainingSources: sourceCount - index - 1,
    });
    ceilings.push(ceiling);

    assert(ceiling - used <= MUNICIPAL_MAX_FETCHES_PER_SOURCE_WINDOW);
    assert(
      hardLimit - ceiling >=
        (sourceCount - index - 1) *
          MUNICIPAL_MIN_FETCH_RESERVE_PER_SOURCE,
    );

    used = ceiling;
  }

  assert.deepEqual(ceilings.slice(0, 4), [3, 6, 9, 12]);
  assert.equal(ceilings.at(-1), 35);
});

test("municipal fetch ceiling never exceeds the global hard limit", () => {
  assert.equal(
    municipalSourceFetchCeiling({
      used: 34,
      hardLimit: 35,
      remainingSources: 0,
    }),
    35,
  );
  assert.equal(
    municipalSourceFetchCeiling({
      used: 35,
      hardLimit: 35,
      remainingSources: 0,
    }),
    35,
  );
});
