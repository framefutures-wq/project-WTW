// Remote-development-only entry point. Never configured on the public Worker.
import { parseTourResponse, TOUR_API_BASE } from "../worker/sources/tourapi";
import type { Env } from "../worker/env";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health")
      return Response.json({ ready: Boolean(env.TOUR_API_KEY) });
    const id = url.searchParams.get("id") || "";
    if (!/^\d{1,40}$/.test(id) || !env.TOUR_API_KEY)
      return new Response("Invalid request", { status: 400 });
    const event = await env.DB.prepare(
      "SELECT e.id FROM events e JOIN sources s ON s.id=e.primary_source_id WHERE e.id=? AND e.is_sample=0 AND s.kind='tourapi'",
    )
      .bind(`tourapi-${id}`)
      .first();
    if (!event) return new Response("Not found", { status: 404 });
    const results = [];
    for (const endpoint of ["detailCommon2", "detailIntro2", "detailInfo2"].filter(
      (e) =>
        !url.searchParams.has("endpoint") ||
        url.searchParams.get("endpoint") === e,
    )) {
      const target = new URL(`${TOUR_API_BASE}/${endpoint}`);
      target.search = new URLSearchParams({
        serviceKey: env.TOUR_API_KEY,
        MobileOS: "WEB",
        MobileApp: "project-WTW",
        _type: "json",
        contentId: id,
        numOfRows: "10",
        pageNo: "1",
        ...(endpoint === "detailIntro2" || endpoint === "detailInfo2"
          ? { contentTypeId: "15" }
          : {}),
      }).toString();
      const checkedAt = new Date().toISOString();
      let httpStatus: number | null = null;
      try {
        const response = await fetch(target, {
          redirect: "manual",
          signal: AbortSignal.timeout(20000),
        });
        httpStatus = response.status;
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error("http_error");
        }
        const payload = (await response.json()) as {
          response?: { header?: { resultCode?: string } };
        };
        const code = String(payload.response?.header?.resultCode || "");
        if (!["0000", "00"].includes(code)) {
          results.push({
            endpoint,
            checkedAt,
            httpStatus,
            status: "response_failure",
            providerCode: /^\d{2,4}$/.test(code) ? code : "invalid",
            items: [],
          });
          continue;
        }
        let parsed;
        try {
          parsed = parseTourResponse(payload);
        } catch {
          results.push({
            endpoint,
            checkedAt,
            httpStatus,
            status: "invalid_shape",
            items: [],
          });
          continue;
        }
        if (parsed.items.some((row) => String(row.contentid) !== id))
          throw new Error("content_id_mismatch");
        results.push({
          endpoint,
          checkedAt,
          httpStatus,
          status: parsed.items.length ? "success" : "empty",
          items: parsed.items,
        });
      } catch {
        // Never propagate an exception that could contain a credential-bearing URL.
        results.push({
          endpoint,
          checkedAt,
          httpStatus,
          status: httpStatus === null ? "network_failure" : "response_failure",
          items: [],
        });
      }
    }
    return Response.json({ contentId: id, results });
  },
};
