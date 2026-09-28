import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import app from "../worker/index";

async function setup() {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('ok')}}",
      compatibilityDate: "2026-09-18",
      d1Databases: ["DB"],
      cf: false,
    }),
  );
  const DB = await mf.getD1Database("DB");
  for (const file of readdirSync("migrations").sort())
    for (const sql of readFileSync("migrations/" + file, "utf8")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean))
      await DB.prepare(sql).run();
  return { mf, DB };
}

test("municipal rich detail reaches the public detail API under an encoded legacy id", async () => {
  const { mf, DB } = await setup();
  const eventId =
    "municipal-seoul-hangang-legacy|달빛한가위마당|2026-09-27";
  const sourceId = "municipal-source-" + eventId;
  const detailUrl =
    "https://hangang.seoul.go.kr/www/eventMng/detail.do?mid=538&srchType=list&evntSn=462";
  const primaryImage =
    "https://hangang.seoul.go.kr/www/file/thumbnail.do?fkey=primary";
  const secondaryImage =
    "https://hangang.seoul.go.kr/www/file/thumbnail.do?fkey=secondary";
  try {
    await DB.prepare(
      `INSERT INTO sources(
        id,kind,priority,name,url,fetched_at,raw_payload
      ) VALUES(?, 'municipality', 2, '서울 한강 공식 행사 안내', ?, ?, ?)`,
    )
      .bind(
        sourceId,
        detailUrl,
        "2026-09-27T06:00:00.000Z",
        JSON.stringify({
          municipal_rich_detail: {
            contact_phone: "120",
            price_text: "무료",
          },
        }),
      )
      .run();

    await DB.prepare(
      `INSERT INTO events(
        id,title,description,region,venue,address,start_date,end_date,
        lat,lng,cost,price_text,pet_policy,status,verification,is_sample,
        primary_source_id,checked_at,updated_at
      ) VALUES(
        ?,'달빛 한가위 마당 (차없는 잠수교 뚜벅뚜벅 축제)',
        '공식 지자체 행사 안내를 바탕으로 등록된 행사입니다.',
        '서울','반포한강공원 잠수교 달빛광장','반포한강공원 잠수교 달빛광장',
        '2026-09-27','2026-09-27',NULL,NULL,'free','무료','unknown',
        'scheduled','verified',0,?,?,?
      )`,
    )
      .bind(
        eventId,
        sourceId,
        "2026-09-27T06:00:00.000Z",
        "2026-09-27T06:00:00.000Z",
      )
      .run();

    for (const field of ["schedule", "venue", "status", "price"])
      await DB.prepare(
        `INSERT INTO event_evidence(
          event_id,source_id,field,excerpt,checked_at
        ) VALUES(?,?,?,?,?)`,
      )
        .bind(
          eventId,
          sourceId,
          field,
          field + "=official",
          "2026-09-27T06:00:00.000Z",
        )
        .run();

    await DB.prepare(
      `INSERT INTO event_enrichments(
        event_id,summary,source_id,evidence_excerpt,updated_at
      ) VALUES(?,?,?,?,?)`,
    )
      .bind(
        eventId,
        "6개국 전통 공연과 한복 대여, 전통놀이 체험을 즐길 수 있습니다.",
        sourceId,
        "official_summary",
        "2026-09-27T06:00:00.000Z",
      )
      .run();

    for (const [index, start, end] of [
      [0, "15:00", "16:00"],
      [1, "17:00", "18:00"],
    ] as const)
      await DB.prepare(
        `INSERT INTO event_operating_hours(
          id,event_id,start_date,end_date,start_time,end_time,
          human_time_text,sort_order,source_id,evidence_excerpt
        ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      )
        .bind(
          eventId + "-hours-" + index,
          eventId,
          "2026-09-27",
          "2026-09-27",
          start,
          end,
          "15:00~16:00, 17:00~18:00",
          index,
          sourceId,
          "official_time",
        )
        .run();

    for (const [index, name] of [
      [0, "6개국 전통 공연"],
      [1, "한복 대여"],
      [2, "전통놀이 체험"],
    ] as const)
      await DB.prepare(
        `INSERT INTO event_programs(
          id,event_id,program_name,program_date,start_time,end_time,
          schedule_text,venue_name,description,featured,sort_order,
          source_id,evidence_excerpt,updated_at
        ) VALUES(?,?,?,NULL,NULL,NULL,NULL,NULL,?,0,?,?,?,?)`,
      )
        .bind(
          eventId + "-program-" + index,
          eventId,
          name,
          name + " 공식 프로그램",
          index,
          sourceId,
          "official_program",
          "2026-09-27T06:00:00.000Z",
        )
        .run();

    await DB.prepare(
      `INSERT INTO event_images(
        event_id,image_url,source_type,source_page_url,is_primary,image_status,
        width,height,mime_type,last_checked_at,evidence_note
      ) VALUES(?,?, 'municipality', ?,1,'ok',NULL,NULL,NULL,?,?)`,
    )
      .bind(
        eventId,
        primaryImage,
        detailUrl,
        "2026-09-27T06:00:00.000Z",
        "official_image",
      )
      .run();
    await DB.prepare(
      `INSERT INTO event_additional_images(
        event_id,image_url,source_type,source_page_url,sort_order,image_status,
        width,height,mime_type,last_checked_at,evidence_note
      ) VALUES(?,?, 'municipality', ?,2,'ok',NULL,NULL,NULL,?,?)`,
    )
      .bind(
        eventId,
        secondaryImage,
        detailUrl,
        "2026-09-27T06:00:00.000Z",
        "official_image",
      )
      .run();

    const env = {
      DB,
      APP_MODE: "production",
      TOUR_API_ENABLED: "false",
      ASSETS: { fetch: () => new Response("asset") },
      WEB_PUSH_ENABLED: "false",
    } as any;

    const response = await app.fetch(
      new Request(
        "https://galteum.com/api/events/" + encodeURIComponent(eventId),
      ),
      env,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as any;

    assert.match(body.enrichment?.summary ?? "", /6개국 전통 공연/);
    assert.deepEqual(
      body.enrichment.programs.map((program: any) => program.name),
      ["6개국 전통 공연", "한복 대여", "전통놀이 체험"],
    );
    assert.equal(body.operating_hours.length, 2);
    assert.deepEqual(body.contact_phone, {
      display: "120",
      href: "tel:120",
    });
    assert.equal(body.images.length, 2);
    assert.match(
      body.event.image_url,
      new RegExp(
        "/api/events/" +
          encodeURIComponent(eventId).replace(/[.*+?^$()|[\]{}]/g, "\\$&") +
          "/image/1$",
      ),
    );
    assert.match(
      body.images[0].image_url,
      new RegExp(
        "/api/events/" +
          encodeURIComponent(eventId).replace(/[.*+?^$()|[\\]{}]/g, "\\$&") +
          "/image/1$",
      ),
    );

    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const cacheEntries = new Map<string, Response>();
    let matchPlan: Array<Response | null> | null = null;
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      value: {
        default: {
          match: async (key: Request) => {
            if (matchPlan?.length) return matchPlan.shift()?.clone() ?? null;
            return cacheEntries.get(key.url)?.clone() ?? null;
          },
          put: async (key: Request, value: Response) => {
            cacheEntries.set(key.url, value.clone());
          },
        },
      },
    });
    try {
      const imageRequest = new Request(body.images[0].image_url);
      let attempts = 0;
      let referer: string | null = null;
      globalThis.fetch = async (input, init) => {
        attempts += 1;
        assert.equal(String(input), primaryImage);
        referer = new Headers(init?.headers).get("Referer");
        if (attempts === 1) return new Response("busy", { status: 500 });
        if (attempts === 2) return new Response("rate limited", { status: 429 });
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: {
            "Content-Type": "image/png",
            "Content-Length": "4",
          },
        });
      };
      const imageResponse = await app.fetch(imageRequest, env);
      assert.equal(imageResponse.status, 200);
      assert.equal(attempts, 3);
      assert.equal(imageResponse.headers.get("Content-Type"), "image/png");
      assert.equal(referer, detailUrl);
      assert.deepEqual(
        [...new Uint8Array(await imageResponse.arrayBuffer())],
        [137, 80, 78, 71],
      );

      attempts = 0;
      const cachedResponse = await app.fetch(imageRequest, env);
      assert.equal(cachedResponse.status, 200);
      assert.equal(attempts, 0);
      assert.equal(cacheEntries.has(imageRequest.url), true);

      // A cache lookup racing with an in-flight fill can still fall back after
      // all three bounded upstream attempts fail.
      matchPlan = [null, cacheEntries.get(imageRequest.url)!.clone()];
      attempts = 0;
      globalThis.fetch = async () => {
        attempts += 1;
        return new Response("rate limited", { status: 429 });
      };
      const fallbackResponse = await app.fetch(imageRequest, env);
      assert.equal(fallbackResponse.status, 200);
      assert.equal(attempts, 3);

      cacheEntries.delete(imageRequest.url);
      attempts = 0;
      globalThis.fetch = async () => {
        attempts += 1;
        return new Response("upstream failed", { status: 503 });
      };
      const exhaustedResponse = await app.fetch(imageRequest, env);
      assert.equal(exhaustedResponse.status, 503);
      assert.equal(attempts, 3);
      assert.equal(cacheEntries.has(imageRequest.url), false);

      cacheEntries.delete(imageRequest.url);
      attempts = 0;
      globalThis.fetch = async () => {
        attempts += 1;
        if (attempts === 1)
          return new Response("rate limited", { status: 429 });
        return new Response(new Uint8Array([137, 80, 78, 78]), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      };
      assert.equal((await app.fetch(imageRequest, env)).status, 200);
      assert.equal(attempts, 2);

      // Network exceptions get exactly one retry too.
      cacheEntries.delete(imageRequest.url);
      attempts = 0;
      globalThis.fetch = async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("network failure");
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      };
      assert.equal((await app.fetch(imageRequest, env)).status, 200);
      assert.equal(attempts, 2);

      // A successful first fetch is not retried, and only valid images cache.
      cacheEntries.delete(imageRequest.url);
      attempts = 0;
      globalThis.fetch = async () => {
        attempts += 1;
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      };
      assert.equal((await app.fetch(imageRequest, env)).status, 200);
      assert.equal(attempts, 1);
      assert.equal(cacheEntries.has(imageRequest.url), true);

      cacheEntries.delete(imageRequest.url);
      attempts = 0;
      globalThis.fetch = async () => {
        attempts += 1;
        return new Response("not an image", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      };
      const invalidImage = await app.fetch(imageRequest, env);
      assert.equal(invalidImage.status, 502);
      assert.equal(attempts, 1);
      assert.equal(cacheEntries.has(imageRequest.url), false);

      await DB.prepare(
        "UPDATE event_images SET image_url=? WHERE event_id=? AND is_primary=1",
      )
        .bind("https://hangang.seoul.go.kr/www/imgViewer.jsp?ext=jpg", eventId)
        .run();
      cacheEntries.delete(imageRequest.url);
      attempts = 0;
      globalThis.fetch = async (_input, init) => {
        attempts += 1;
        assert.equal(new Headers(init?.headers).get("Referer"), detailUrl);
        return new Response(new Uint8Array([255, 216, 255]), {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      };
      const viewerImage = await app.fetch(imageRequest, env);
      assert.equal(viewerImage.status, 200);
      assert.equal(viewerImage.headers.get("Content-Type"), "image/jpeg");
      assert.equal(attempts, 1);

      const absentSlot = await app.fetch(
        new Request(imageRequest.url.replace(/\/image\/1$/, "/image/3")),
        env,
      );
      assert.equal(absentSlot.status, 404);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalCaches === undefined) delete (globalThis as any).caches;
      else
        Object.defineProperty(globalThis, "caches", { value: originalCaches });
    }
  } finally {
    await mf.dispose();
  }
});
