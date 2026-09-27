import type { Env } from "../worker/env";
import { runOfficialDetailRecovery } from "../worker/sources/official-detail-recovery";

type OfficialDetailOnceEnv = Env & {
  MANUAL_OFFICIAL_DETAIL_NONCE?: string;
};

export default {
  async fetch(request: Request, env: OfficialDetailOnceEnv) {
    if (request.method !== "POST")
      return new Response("Not found", { status: 404 });
    if (
      request.headers.get("x-manual-official-detail-nonce") !==
      env.MANUAL_OFFICIAL_DETAIL_NONCE
    )
      return new Response("Forbidden", { status: 403 });

    const rawLimit = Number(
      request.headers.get("x-manual-official-detail-limit") ?? "12",
    );
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 20)
      return Response.json({ error: "invalid_limit" }, { status: 400 });

    try {
      const result = await runOfficialDetailRecovery(env, new Date(), {
        limit: rawLimit,
      });
      return Response.json({ ok: true, result });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "unknown",
        },
        { status: 500 },
      );
    }
  },
};
