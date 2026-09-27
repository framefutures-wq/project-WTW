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
    const rawSource = request.headers.get("x-manual-municipal-source");
    if (rawShard !== null && rawSource !== null)
      return Response.json({ error: "ambiguous_manual_target" }, { status: 400 });

    let sourceKey: string | null = null;
    if (rawSource !== null) {
      try {
        sourceKey = decodeURIComponent(rawSource);
      } catch {
        return Response.json({ error: "invalid_source_encoding" }, { status: 400 });
      }
      if (!registryKeys.includes(sourceKey))
        return Response.json(
          { error: "invalid_source", sourceKey },
          { status: 400 },
        );
    }

    let shardIndex: number;
    if (sourceKey) {
      const matchedShard = Array.from(
        { length: MUNICIPAL_DAILY_SHARD_COUNT },
        (_, index) => index,
      ).find((index) =>
        municipalRunPlan(registryKeys, index).sourceKeys.includes(sourceKey!),
      );
      if (matchedShard === undefined)
        return Response.json({ error: "source_shard_not_found" }, { status: 500 });
      shardIndex = matchedShard;
    } else {
      shardIndex = Number(rawShard);
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
    }

    const productionPlan = municipalRunPlan(registryKeys, shardIndex);
    const plan = sourceKey
      ? { ...productionPlan, sourceKeys: [sourceKey] }
      : productionPlan;
    const startedAt = new Date().toISOString();
    try {
      const summary = await runMunicipalAutonomous(env, plan);
      return Response.json({
        ok: true,
        startedAt,
        finishedAt: new Date().toISOString(),
        shardIndex,
        sourceKey,
        shardCount: MUNICIPAL_DAILY_SHARD_COUNT,
        registrySourceCount: registryKeys.length,
        plan,
        summary,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "unknown");
      const stack =
        error instanceof Error && error.stack
          ? error.stack.split("\n").slice(0, 12).join("\n")
          : null;
      console.error("manual_municipal_shard_failed", {
        shardIndex,
        message,
        stack,
      });
      return Response.json(
        {
          ok: false,
          startedAt,
          finishedAt: new Date().toISOString(),
          shardIndex,
          sourceKey,
          shardCount: MUNICIPAL_DAILY_SHARD_COUNT,
          registrySourceCount: registryKeys.length,
          plan,
          error: {
            message,
            stack,
          },
        },
        { status: 500 },
      );
    }
  },
};
