import { runMunicipalAutonomous } from "../worker/sources/municipal";
import type { Env } from "../worker/env";
import { MUNICIPAL_SOURCE_REGISTRY } from "../shared/municipal-source-registry";
import {
  MUNICIPAL_DAILY_SHARD_COUNT,
  municipalRunPlan,
} from "../shared/municipal-run-plan";

type MunicipalOnceEnv = Env & { MANUAL_MUNICIPAL_NONCE?: string };

const registryKeys = MUNICIPAL_SOURCE_REGISTRY.map((source) => source.key);

export default {
  async fetch(request: Request, env: MunicipalOnceEnv) {
    if (request.method !== "POST")
      return new Response("Not found", { status: 404 });
    if (
      request.headers.get("x-manual-municipal-nonce") !==
      env.MANUAL_MUNICIPAL_NONCE
    )
      return new Response("Forbidden", { status: 403 });

    const rawShard = request.headers.get("x-manual-municipal-shard");
    const shardIndex = Number(rawShard);
    if (
      rawShard === null ||
      !Number.isInteger(shardIndex) ||
      shardIndex < 0 ||
      shardIndex >= MUNICIPAL_DAILY_SHARD_COUNT
    )
      return Response.json(
        {
          error: "invalid_shard",
          shardCount: MUNICIPAL_DAILY_SHARD_COUNT,
        },
        { status: 400 },
      );

    const plan = municipalRunPlan(registryKeys, shardIndex);
    const startedAt = new Date().toISOString();
    const summary = await runMunicipalAutonomous(env, plan);

    return Response.json({
      startedAt,
      finishedAt: new Date().toISOString(),
      shardIndex,
      shardCount: MUNICIPAL_DAILY_SHARD_COUNT,
      registrySourceCount: registryKeys.length,
      plan,
      summary,
    });
  },
};
