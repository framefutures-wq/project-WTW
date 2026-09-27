import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  assessMunicipalPrice,
  persistMunicipalRichDetail,
} from "../worker/sources/municipal-rich-detail";

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

async function seedBase(DB, primarySource = "municipality") {
  await DB.prepare(
    "INSERT INTO sources(id,kind,priority,name,url,fetched_at,raw_payload) VALUES('tour','tourapi',3,'TourAPI','https://example.com/tour','2026-09-27T00:00:00Z',NULL)",
  ).run();
  await DB.prepare(
    "INSERT INTO sources(id,kind,priority,name,url,fetched_at,raw_payload) VALUES('municipality','municipality',2,'공식 지자체','https://city.example.go.kr/event/1','2026-09-27T00:00:00Z',NULL)",
  ).run();
  await DB.prepare(
    "INSERT INTO sources(id,kind,priority,name,url,fetched_at,raw_payload) VALUES('organizer','organizer',1,'공식 주최','https://organizer.example.com/event/1','2026-09-27T00:00:00Z',NULL)",
  ).run();
  await DB.prepare(
    `INSERT INTO events(
      id,title,description,region,venue,address,start_date,end_date,
      lat,lng,cost,price_text,pet_policy,status,verification,is_sample,
      primary_source_id,checked_at
    ) VALUES(
      'event-1','테스트 행사','기존 설명','서울','테스트 장소','테스트 장소',
      '2026-09-27','2026-09-27',NULL,NULL,'paid','기존 요금',
      'unknown','scheduled','verified',0,?,'2026-09-27T00:00:00Z'
    )`,
  )
    .bind(primarySource)
    .run();
}

const richDetail = {
  summary: "공식 상세 페이지에서 확인한 행사 소개입니다.",
  operating_hours: [
    {
      start_time: "15:00",
      end_time: "16:00",
      human_time_text: "15:00~16:00, 17:00~18:00",
    },
    {
      start_time: "17:00",
      end_time: "18:00",
      human_time_text: "15:00~16:00, 17:00~18:00",
    },
  ],
  price_text: "무료",
  contact_phone: "120",
  images: [
    {
      url: "https://city.example.go.kr/images/main.jpg",
      alt: "행사 대표 이미지",
    },
    {
      url: "https://city.example.go.kr/images/program-1.jpg",
      alt: "행사 프로그램 이미지",
    },
    {
      url: "https://city.example.go.kr/images/program-2.jpg",
      alt: "행사 프로그램 이미지 2",
    },
  ],
  programs: [
    {
      name: "전통 공연",
      description: "전통 의상과 민속 공연",
      schedule_text: "15:00, 17:00",
    },
    {
      name: "전통놀이 체험",
      description: "가족과 함께하는 전통놀이 체험",
      schedule_text: null,
    },
  ],
};

test("explicit municipal price field accepts bare 무료/유료 safely", () => {
  assert.equal(assessMunicipalPrice("무료", 2026).status, "free");
  assert.equal(assessMunicipalPrice("유료", 2026).status, "paid");
  assert.equal(
    assessMunicipalPrice("무료 주차", 2026).status,
    "unknown",
  );
});

test("municipal rich detail replaces lower-priority TourAPI detail", async () => {
  const { mf, DB } = await setup();
  try {
    await seedBase(DB);

    await DB.prepare(
      "INSERT INTO event_enrichments(event_id,summary,source_id,evidence_excerpt,updated_at) VALUES('event-1','TourAPI 요약','tour','old','2026-09-27T00:00:00Z')",
    ).run();
    await DB.prepare(
      "INSERT INTO event_evidence(event_id,source_id,field,excerpt,checked_at) VALUES('event-1','tour','price','기존 가격','2026-09-27T00:00:00Z')",
    ).run();
    await DB.prepare(
      `INSERT INTO event_operating_hours(
        id,event_id,start_date,end_date,start_time,end_time,human_time_text,
        sort_order,source_id,evidence_excerpt
      ) VALUES(
        'old-hours','event-1','2026-09-27','2026-09-27',
        '10:00','11:00',NULL,0,'tour','old'
      )`,
    ).run();
    await DB.prepare(
      `INSERT INTO event_programs(
        id,event_id,program_name,program_date,start_time,end_time,
        schedule_text,venue_name,description,featured,sort_order,
        source_id,evidence_excerpt,updated_at
      ) VALUES(
        'old-program','event-1','TourAPI 프로그램',NULL,NULL,NULL,
        NULL,NULL,'old',0,0,'tour','old','2026-09-27T00:00:00Z'
      )`,
    ).run();
    await DB.prepare(
      `INSERT INTO event_images(
        event_id,image_url,source_type,source_page_url,is_primary,image_status,
        width,height,mime_type,last_checked_at,evidence_note
      ) VALUES(
        'event-1','https://example.com/tour.jpg','tourapi',
        'https://example.com/tour',1,'ok',NULL,NULL,NULL,
        '2026-09-27T00:00:00Z','old'
      )`,
    ).run();
    await DB.prepare(
      `INSERT INTO event_additional_images(
        event_id,image_url,source_type,source_page_url,sort_order,image_status,
        width,height,mime_type,last_checked_at,evidence_note
      ) VALUES(
        'event-1','https://example.com/tour-2.jpg','tourapi',
        'https://example.com/tour',2,'ok',NULL,NULL,NULL,
        '2026-09-27T00:00:00Z','old'
      )`,
    ).run();

    await persistMunicipalRichDetail(DB, {
      eventId: "event-1",
      startDate: "2026-09-27",
      endDate: "2026-09-27",
      sourceId: "municipality",
      sourceUrl: "https://city.example.go.kr/event/1",
      checkedAt: "2026-09-27T01:00:00Z",
      detail: richDetail,
    });

    const event = await DB.prepare(
      "SELECT cost,price_text FROM events WHERE id='event-1'",
    ).first<{ cost: string; price_text: string | null }>();
    assert.deepEqual(event, { cost: "free", price_text: "무료" });

    const enrichment = await DB.prepare(
      "SELECT summary,source_id FROM event_enrichments WHERE event_id='event-1'",
    ).first<{ summary: string; source_id: string }>();
    assert.equal(enrichment?.summary, richDetail.summary);
    assert.equal(enrichment?.source_id, "municipality");

    const hours = await DB.prepare(
      "SELECT start_time,end_time,source_id FROM event_operating_hours WHERE event_id='event-1' ORDER BY sort_order",
    ).all<{ start_time: string; end_time: string; source_id: string }>();
    assert.deepEqual(
      hours.results.map((row) => [row.start_time, row.end_time, row.source_id]),
      [
        ["15:00", "16:00", "municipality"],
        ["17:00", "18:00", "municipality"],
      ],
    );

    const programs = await DB.prepare(
      "SELECT program_name,source_id FROM event_programs WHERE event_id='event-1' ORDER BY sort_order",
    ).all<{ program_name: string; source_id: string }>();
    assert.deepEqual(
      programs.results.map((row) => [row.program_name, row.source_id]),
      [
        ["전통 공연", "municipality"],
        ["전통놀이 체험", "municipality"],
      ],
    );

    const primary = await DB.prepare(
      "SELECT image_url,source_type FROM event_images WHERE event_id='event-1'",
    ).first<{ image_url: string; source_type: string }>();
    assert.deepEqual(primary, {
      image_url: richDetail.images[0].url,
      source_type: "municipality",
    });

    const additional = await DB.prepare(
      "SELECT image_url,source_type,sort_order FROM event_additional_images WHERE event_id='event-1' ORDER BY sort_order",
    ).all<{ image_url: string; source_type: string; sort_order: number }>();
    assert.deepEqual(
      additional.results.map((row) => [
        row.image_url,
        row.source_type,
        row.sort_order,
      ]),
      [
        [richDetail.images[1].url, "municipality", 2],
        [richDetail.images[2].url, "municipality", 3],
      ],
    );

    const source = await DB.prepare(
      "SELECT raw_payload FROM sources WHERE id='municipality'",
    ).first<{ raw_payload: string }>();
    assert.equal(
      JSON.parse(source!.raw_payload).municipal_rich_detail.contact_phone,
      "120",
    );
  } finally {
    await mf.dispose();
  }
});

test("municipal rich detail preserves higher-priority organizer facts", async () => {
  const { mf, DB } = await setup();
  try {
    await seedBase(DB, "organizer");

    await DB.prepare(
      "INSERT INTO event_enrichments(event_id,summary,source_id,evidence_excerpt,updated_at) VALUES('event-1','주최 측 요약','organizer','organizer','2026-09-27T00:00:00Z')",
    ).run();
    await DB.prepare(
      "INSERT INTO event_evidence(event_id,source_id,field,excerpt,checked_at) VALUES('event-1','organizer','price','참가비 5,000원','2026-09-27T00:00:00Z')",
    ).run();
    await DB.prepare(
      "UPDATE events SET cost='paid',price_text='참가비 5,000원' WHERE id='event-1'",
    ).run();
    await DB.prepare(
      `INSERT INTO event_operating_hours(
        id,event_id,start_date,end_date,start_time,end_time,human_time_text,
        sort_order,source_id,evidence_excerpt
      ) VALUES(
        'organizer-hours','event-1','2026-09-27','2026-09-27',
        '13:00','14:00',NULL,0,'organizer','organizer'
      )`,
    ).run();
    await DB.prepare(
      `INSERT INTO event_programs(
        id,event_id,program_name,program_date,start_time,end_time,
        schedule_text,venue_name,description,featured,sort_order,
        source_id,evidence_excerpt,updated_at
      ) VALUES(
        'organizer-program','event-1','주최 측 프로그램',NULL,NULL,NULL,
        NULL,NULL,'organizer',0,0,'organizer','organizer',
        '2026-09-27T00:00:00Z'
      )`,
    ).run();
    await DB.prepare(
      `INSERT INTO event_images(
        event_id,image_url,source_type,source_page_url,is_primary,image_status,
        width,height,mime_type,last_checked_at,evidence_note
      ) VALUES(
        'event-1','https://organizer.example.com/main.jpg','organizer',
        'https://organizer.example.com/event/1',1,'ok',NULL,NULL,NULL,
        '2026-09-27T00:00:00Z','organizer'
      )`,
    ).run();

    await persistMunicipalRichDetail(DB, {
      eventId: "event-1",
      startDate: "2026-09-27",
      endDate: "2026-09-27",
      sourceId: "municipality",
      sourceUrl: "https://city.example.go.kr/event/1",
      checkedAt: "2026-09-27T01:00:00Z",
      detail: richDetail,
    });

    const event = await DB.prepare(
      "SELECT cost,price_text FROM events WHERE id='event-1'",
    ).first<{ cost: string; price_text: string | null }>();
    assert.deepEqual(event, {
      cost: "paid",
      price_text: "참가비 5,000원",
    });

    const enrichment = await DB.prepare(
      "SELECT summary,source_id FROM event_enrichments WHERE event_id='event-1'",
    ).first<{ summary: string; source_id: string }>();
    assert.deepEqual(enrichment, {
      summary: "주최 측 요약",
      source_id: "organizer",
    });

    const hours = await DB.prepare(
      "SELECT start_time,source_id FROM event_operating_hours WHERE event_id='event-1'",
    ).all<{ start_time: string; source_id: string }>();
    assert.deepEqual(hours.results, [
      { start_time: "13:00", source_id: "organizer" },
    ]);

    const programs = await DB.prepare(
      "SELECT program_name,source_id FROM event_programs WHERE event_id='event-1'",
    ).all<{ program_name: string; source_id: string }>();
    assert.deepEqual(programs.results, [
      { program_name: "주최 측 프로그램", source_id: "organizer" },
    ]);

    const primary = await DB.prepare(
      "SELECT image_url,source_type FROM event_images WHERE event_id='event-1'",
    ).first<{ image_url: string; source_type: string }>();
    assert.deepEqual(primary, {
      image_url: "https://organizer.example.com/main.jpg",
      source_type: "organizer",
    });
  } finally {
    await mf.dispose();
  }
});
