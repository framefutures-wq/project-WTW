export const MUNICIPAL_DAILY_SHARD_COUNT = 3;

const PUBLISH_MUTATION_CAPS = [4, 3, 3] as const;
const RETRY_CANDIDATE_CAPS = [4, 4, 4] as const;
const DETAIL_FETCH_CAPS = [6, 4, 4] as const;
const EXTERNAL_FETCH_CAP = 35;

export type MunicipalRunPlan = {
  shardIndex: number;
  sourceKeys: string[];
  maxPublishMutations: number;
  maxRetryCandidates: number;
  maxDetailFetches: number;
  maxExternalFetches: number;
};

export function municipalRunPlan(
  sourceKeys: readonly string[],
  shardIndex: number,
): MunicipalRunPlan {
  if (
    !Number.isInteger(shardIndex) ||
    shardIndex < 0 ||
    shardIndex >= MUNICIPAL_DAILY_SHARD_COUNT
  )
    throw new Error("invalid municipal shard index");

  const size = Math.ceil(sourceKeys.length / MUNICIPAL_DAILY_SHARD_COUNT);
  const start = shardIndex * size;
  const keys = sourceKeys.slice(start, start + size);

  return {
    shardIndex,
    sourceKeys: [...keys],
    maxPublishMutations: PUBLISH_MUTATION_CAPS[shardIndex],
    maxRetryCandidates: RETRY_CANDIDATE_CAPS[shardIndex],
    maxDetailFetches: DETAIL_FETCH_CAPS[shardIndex],
    maxExternalFetches: EXTERNAL_FETCH_CAP,
  };
}
