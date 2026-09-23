import { runMunicipalAutonomous } from "../worker/sources/municipal";
import type { Env } from "../worker/env";

type MunicipalOnceEnv = Env & { MANUAL_MUNICIPAL_NONCE?: string };

export default {
  async fetch(request: Request, env: MunicipalOnceEnv) {
    if (request.method !== "POST") return new Response("Not found", { status: 404 });
    if (request.headers.get("x-manual-municipal-nonce") !== env.MANUAL_MUNICIPAL_NONCE)
      return new Response("Forbidden", { status: 403 });
    const startedAt = new Date().toISOString();
    const summary = await runMunicipalAutonomous(env);
    return Response.json({ startedAt, finishedAt: new Date().toISOString(), summary });
  },
};
