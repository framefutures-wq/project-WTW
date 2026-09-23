import { runDetailScheduled } from "../worker/cron";
import type { Env } from "../worker/env";

type MaintenanceEnv = Env & { MANUAL_DETAIL_NONCE?: string };

export default {
  async fetch(request: Request, env: MaintenanceEnv) {
    if (request.method !== "POST") return new Response("Not found", { status: 404 });
    if (request.headers.get("x-manual-detail-nonce") !== env.MANUAL_DETAIL_NONCE)
      return new Response("Forbidden", { status: 403 });
    let manualRunId = "";
    try { manualRunId = String((await request.json() as { manualRunId?: unknown }).manualRunId ?? ""); } catch {}
    if (!/^[a-f0-9-]{16,64}$/i.test(manualRunId)) return new Response("Bad request", { status: 400 });
    const result = await runDetailScheduled(env, new Date(), undefined, "manual", manualRunId);
    return Response.json(result);
  },
};
