import assert from "node:assert/strict";
import test from "node:test";
import { runMunicipalAutonomous } from "../worker/sources/municipal.ts";

const sourceUrls = {
  paju: "https://tour.paju.go.kr/user/link/cultural/BD_index.do",
  suwon: "https://www.swcf.or.kr/?p=29",
  goyang: "https://goyang.go.kr/visitgoyang/www/contents.do?key=595&searchCtgry=1674023925303",
  hwaseong: "https://tour.hscity.go.kr/NEW/6festival/festival5.jsp",
  bucheon: "https://www.bucheon.go.kr/site/homepage/menu/viewMenu?menuid=145007003",
};
const sourceMarkers = {
  paju: "list-info",
  suwon: "<table",
  goyang: "con_item",
  hwaseong: "listBoard",
  bucheon: "9월~10월 기타 축제 및 행사",
};

function pajuList(id = "940", title = "2026 문산거리축제", url = `https://tour.paju.go.kr/detail/${id}`) {
  return `<ul><li><span class="titl">${title}</span><span class="list-info">행사 : 2026-10-03 ~ 2026-10-04 장소 : 문산천 비용 : 무료</span><a href="${url}" onclick="jsCulturalView(${id})">상세</a></li></ul>`;
}
function suwonList(id = "3049", title = "제1회 수원거리축제", url = `https://www.swcf.or.kr/?p=29_view&idx=${id}`) {
  return `<table><tr><td>축제</td><td>2026-10-03 ~ 2026-10-04</td><td><a href="${url}">${title}</a></td><td>수원화성</td></tr></table>`;
}
function suwonListRows(count) {
  return `<table>${Array.from({ length: count }, (_, index) => {
    const id = String(4000 + index);
    return `<tr><td>축제</td><td>2026-10-${String((index % 20) + 1).padStart(2, "0")} ~ 2026-10-31</td><td><a href="https://www.swcf.or.kr/?p=29_view&idx=${id}">수원 행사 ${id}</a></td><td>수원화성</td></tr>`;
  }).join("")}</table>`;
}
function hwaseongList(rows) {
  return `<h1>2026년 화성시 주요 축제</h1><table class="listBoard"><tbody>${rows.map((row, index) => `<tr><td>${index + 1}</td><td>${row.date ?? "10. 3.~10. 4."}</td><td>${row.title}</td><td>문화과</td><td>${row.venue ?? "동탄호수공원"}</td><td>화성시</td></tr>`).join("")}</tbody></table>`;
}
function retryRow(overrides = {}) {
  const id = overrides.candidate_id ?? "municipal-paju-940";
  return {
    candidate_id: id, source_key: "paju", source_candidate_id: "940", title_snapshot: "2026 문산거리축제",
    start_date_snapshot: "2026-10-03", end_date_snapshot: "2026-10-04", venue_snapshot: "문산천",
    locality_snapshot: "파주", official_url_snapshot: "https://tour.paju.go.kr/detail/paju", first_seen_at: "2026-09-20T00:00:00.000Z",
    retry_until: "2026-10-20T00:00:00.000Z", last_payload_hash: "old", ...overrides,
  };
}

function createMockDb({ retries = [], existing = null, duplicateRows = [], state = null, retryQueryRows = retries } = {}) {
  const writes = [], saves = [], queryBinds = [], batches = [];
  const db = {
    prepare(sql) {
      const statement = {
        args: [],
        bind(...args) { this.args = args; queryBinds.push({ sql, args }); return this; },
        async all() {
          if (sql.includes("FROM municipal_candidate_state WHERE decision_state='AUTO_RETRY'")) return { results: retryQueryRows, meta: { rows_read: retryQueryRows.length } };
          if (sql.includes("FROM events WHERE title=?")) return { results: duplicateRows, meta: { rows_read: duplicateRows.length } };
          if (sql.includes("FROM events WHERE is_sample=0")) return { results: [], meta: { rows_read: 0 } };
          return { results: [], meta: { rows_read: 0 } };
        },
        async first() {
          if (sql.includes("FROM municipal_candidate_state WHERE candidate_id=?")) return state;
          if (sql.includes("FROM events WHERE id=?")) return existing;
          return null;
        },
        async run() {
          if (sql.startsWith("INSERT INTO municipal_candidate_state")) saves.push(this.args);
          else if (sql.startsWith("UPDATE municipal_candidate_state")) writes.push({ sql, args: this.args });
          else writes.push({ sql, args: this.args });
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch(statements) { batches.push(statements); return statements.map(() => ({ meta: { changes: 1 } })); },
  };
  return { db, writes, saves, queryBinds, batches };
}

async function withFetch(handler, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const result = await handler(String(url));
    if (result instanceof Response) return result;
    return new Response(result ?? "", { status: 200 });
  };
  try { return await run(); } finally { globalThis.fetch = originalFetch; }
}

function emptySourcePage(url) {
  if (url.includes("cultMstSn="))
    return "2026 문산거리축제 행사 상세";
  if (url === sourceUrls.paju)
    return `<ul><li><span class="list-info">${sourceMarkers.paju}</span></li></ul>`;
  if (url === sourceUrls.suwon)
    return `<table><tr><td>${sourceMarkers.suwon}</td></tr></table>`;
  if (url === sourceUrls.goyang)
    return `<div class="con_item">${sourceMarkers.goyang}</div>`;
  if (url === sourceUrls.hwaseong)
    return `<h1>2026년 화성시 주요 축제</h1><table class="listBoard"><tbody></tbody></table>`;
  if (url === sourceUrls.bucheon)
    return `<h4>${sourceMarkers.bucheon}</h4><ul><li></li></ul>`;
  return "";
}
function productionEnv(db) { return { DB: db, APP_MODE: "production", TOUR_API_ENABLED: "false", ASSETS: {} }; }

test("persisted retry publishes from its detail snapshot when discovery no longer contains it", async () => {
  const writes = [], originalFetch = globalThis.fetch;
  const retry = { candidate_id: "municipal-paju-940", source_key: "paju", source_candidate_id: "940", title_snapshot: "2026 문산거리축제", start_date_snapshot: "2026-10-03", end_date_snapshot: "2026-10-04", venue_snapshot: "문산천", locality_snapshot: "파주", official_url_snapshot: "https://tour.paju.go.kr/detail/paju", first_seen_at: "2026-09-20T00:00:00.000Z", retry_until: "2026-10-20T00:00:00.000Z", last_payload_hash: "old" };
  const db = { prepare(sql) { const statement = { args: [], bind(...args) { this.args = args; return this; }, async all() { if (sql.includes("FROM municipal_candidate_state WHERE decision_state='AUTO_RETRY'")) return { results: [retry], meta: { rows_read: 1 } }; return { results: [], meta: { rows_read: 0 } }; }, async first() { return null; }, async run() { writes.push(sql); return { meta: { changes: 1 } }; } }; return statement; }, async batch(statements) { writes.push(...statements.map(() => "publish")); return statements.map(() => ({ meta: { changes: 1 } })); } };
  globalThis.fetch = async (url) => {
    const value = String(url);
    return new Response(
      value === retry.official_url_snapshot
        ? "2026 문산거리축제 행사 : 2026-10-03 ~ 2026-10-04 장소: 문산천"
        : emptySourcePage(value),
      { status: 200 },
    );
  };
  try {
    const result = await runMunicipalAutonomous({ DB: db, APP_MODE: "production", TOUR_API_ENABLED: "false", ASSETS: {} });
    assert.equal(result.AUTO_PUBLISH, 1);
    assert.ok(writes.includes("publish"));
  } finally { globalThis.fetch = originalFetch; }
});

test("double processing guard publishes and saves a discovered candidate only once when the same retry row is returned", async () => {
  const row = retryRow();
  const mock = createMockDb({ retries: [row], retryQueryRows: [row] });
  const result = await withFetch((url) => url === sourceUrls.paju ? pajuList() : url === row.official_url_snapshot ? "2026 문산거리축제 행사 상세" : emptySourcePage(url), () => runMunicipalAutonomous(productionEnv(mock.db)));
  assert.equal(result.AUTO_PUBLISH, 1);
  assert.equal(mock.batches.length, 1);
  assert.equal(mock.saves.length, 1);
});

test("retry keeps the persisted first-seen TTL instead of extending retry_until", async () => {
  const row = retryRow({ official_url_snapshot: "https://tour.paju.go.kr/detail/conflict" });
  const mock = createMockDb({ retries: [row] });
  await withFetch((url) => url === row.official_url_snapshot ? "2025년 문산거리축제 행사 상세" : emptySourcePage(url), () => runMunicipalAutonomous(productionEnv(mock.db)));
  assert.equal(mock.saves.at(-1)[6], "2026-10-20T00:00:00.000Z");
});

test("retry detail fetch failure does not publish or overwrite the existing event and does not stop another source", async () => {
  const row = retryRow({ official_url_snapshot: "https://tour.paju.go.kr/detail/fails" });
  const mock = createMockDb({ retries: [row] });
  const result = await withFetch((url) => {
    if (url === row.official_url_snapshot) throw new Error("network failure");
    if (url === sourceUrls.suwon) return suwonList();
    if (url === "https://www.swcf.or.kr/?p=29_view&idx=3049") return "제1회 수원거리축제 행사 상세";
    return emptySourcePage(url);
  }, () => runMunicipalAutonomous(productionEnv(mock.db)));
  assert.equal(result.AUTO_PUBLISH, 1);
  assert.equal(mock.batches.length, 1);
  assert.equal(mock.writes.some((write) => write.sql.includes("DELETE") || write.sql.includes("UPDATE events")), false);
});

test("Hwaseong retry fails closed when its stable identity is absent from the current canonical schedule", async () => {
  const row = retryRow({ candidate_id: "municipal-hwaseong-2026-화성축제", source_key: "hwaseong", source_candidate_id: "2026-화성축제", title_snapshot: "화성축제", venue_snapshot: "동탄호수공원", locality_snapshot: "화성", official_url_snapshot: sourceUrls.hwaseong });
  const mock = createMockDb({ retries: [row] });
  const result = await withFetch((url) => url === sourceUrls.hwaseong ? hwaseongList([{ title: "교육 프로그램" }]) : emptySourcePage(url), () => runMunicipalAutonomous(productionEnv(mock.db)));
  assert.equal(result.AUTO_PUBLISH, 0);
  assert.equal(result.AUTO_RETRY, 1);
  assert.equal(mock.batches.length, 0);
});

test("Hwaseong retry uses the reappeared canonical candidate and reruns publication gates", async () => {
  const row = retryRow({ candidate_id: "municipal-hwaseong-2026-화성축제", source_key: "hwaseong", source_candidate_id: "2026-화성축제", title_snapshot: "화성축제", venue_snapshot: "동탄호수공원", locality_snapshot: "화성", official_url_snapshot: sourceUrls.hwaseong });
  const mock = createMockDb({ retries: [row] });
  let hwaseongFetches = 0;
  const result = await withFetch((url) => {
    if (url === sourceUrls.hwaseong) return hwaseongList(hwaseongFetches++ === 0 ? [{ title: "교육 프로그램" }] : [{ title: "화성축제" }]);
    return emptySourcePage(url);
  }, () => runMunicipalAutonomous(productionEnv(mock.db)));
  assert.equal(result.AUTO_PUBLISH, 1);
  assert.equal(mock.batches.length, 1);
  assert.equal(hwaseongFetches, 2);
});

test("retry applies the persisted listing/detail core conflict and remains AUTO_RETRY", async () => {
  const row = retryRow({ official_url_snapshot: "https://tour.paju.go.kr/detail/2025" });
  const mock = createMockDb({ retries: [row] });
  const result = await withFetch((url) => url === row.official_url_snapshot ? "2025년 문산거리축제 행사 상세" : emptySourcePage(url), () => runMunicipalAutonomous(productionEnv(mock.db)));
  assert.equal(result.AUTO_PUBLISH, 0);
  assert.equal(result.AUTO_RETRY, 1);
  assert.equal(mock.saves.at(-1)[4], "AUTO_RETRY");
  assert.equal(mock.saves.at(-1)[5], "core_conflict");
});

test("retry reruns duplicate lookup and excludes a newly confirmed duplicate", async () => {
  const row = retryRow({ official_url_snapshot: "https://tour.paju.go.kr/detail/duplicate" });
  const mock = createMockDb({ retries: [row], duplicateRows: [{ id: "confirmed", title: row.title_snapshot }] });
  const result = await withFetch((url) => url === row.official_url_snapshot ? "2026 문산거리축제 행사 상세" : emptySourcePage(url), () => runMunicipalAutonomous(productionEnv(mock.db)));
  assert.equal(result.AUTO_EXCLUDE, 1);
  assert.equal(result.AUTO_PUBLISH, 0);
  assert.ok(mock.queryBinds.some(({ sql }) => sql.includes("FROM events WHERE title=?")));
  assert.equal(mock.batches.length, 0);
});

test("expired retry rows are cleaned up as AUTO_EXCLUDE and are not published", async () => {
  const row = retryRow({ retry_until: "2026-09-19T00:00:00.000Z" });
  const mock = createMockDb({ retryQueryRows: [] });
  const result = await withFetch((url) => url === row.official_url_snapshot ? "2026 문산거리축제 행사 상세" : emptySourcePage(url), () => runMunicipalAutonomous(productionEnv(mock.db)));
  assert.equal(result.AUTO_PUBLISH, 0);
  assert.equal(mock.writes.some((write) => write.sql.includes("decision_reason='retry_ttl_expired'")), true);
});

test("retry query applies MAX_RETRY_PER_RUN at the database bind boundary", async () => {
  const rows = Array.from({ length: 30 }, (_, index) => retryRow({ candidate_id: `municipal-paju-${index}`, source_candidate_id: String(index), official_url_snapshot: `https://tour.paju.go.kr/detail/${index}` }));
  const mock = createMockDb({ retryQueryRows: rows.slice(0, 25) });
  let detailFetches = 0;
  await withFetch((url) => { if (url.startsWith("https://tour.paju.go.kr/detail/")) { detailFetches += 1; return "2026 문산거리축제 행사 상세"; } return emptySourcePage(url); }, () => runMunicipalAutonomous(productionEnv(mock.db)));
  const retryQuery = mock.queryBinds.find(({ sql }) => sql.includes("FROM municipal_candidate_state WHERE decision_state='AUTO_RETRY'"));
  assert.equal(retryQuery.args.at(-1), 25);
  assert.equal(detailFetches, 25);
});

test("one failed retry candidate is isolated while the next retry candidate reaches AUTO_PUBLISH", async () => {
  const failed = retryRow({ candidate_id: "municipal-paju-failed", source_candidate_id: "failed", official_url_snapshot: "https://tour.paju.go.kr/detail/failed" });
  const healthy = retryRow({ candidate_id: "municipal-paju-healthy", source_candidate_id: "healthy", official_url_snapshot: "https://tour.paju.go.kr/detail/healthy" });
  const mock = createMockDb({ retryQueryRows: [failed, healthy] });
  const result = await withFetch((url) => { if (url === failed.official_url_snapshot) throw new Error("network failure"); if (url === healthy.official_url_snapshot) return "2026 문산거리축제 행사 상세"; return emptySourcePage(url); }, () => runMunicipalAutonomous(productionEnv(mock.db)));
  assert.equal(result.AUTO_RETRY, 1);
  assert.equal(result.AUTO_PUBLISH, 1);
  assert.equal(mock.batches.length, 1);
});

test("zero-candidate trusted source trips its breaker while another source continues", async () => {
  const mock = createMockDb();
  const result = await withFetch((url) => {
    if (url === sourceUrls.paju) return sourceMarkers.paju;
    if (url === sourceUrls.suwon) return suwonList();
    if (url === "https://www.swcf.or.kr/?p=29_view&idx=3049") return "제1회 수원거리축제 행사 상세";
    return emptySourcePage(url);
  }, () => runMunicipalAutonomous(productionEnv(mock.db)));
  assert.equal(result.source_errors >= 1, true);
  assert.equal(result.AUTO_PUBLISH, 1);
  assert.equal(mock.batches.length, 1);
});

test("Suwon healthy 31-row canonical list selects a deterministic downstream 25 without a source breaker", async () => {
  const mock = createMockDb();
  const result = await withFetch((url) => {
    if (url === sourceUrls.suwon) return suwonListRows(31);
    if (url.startsWith("https://www.swcf.or.kr/?p=29_view&idx="))
      return "수원 공식 행사 상세";
    return emptySourcePage(url);
  }, () => runMunicipalAutonomous(productionEnv(mock.db)));
  const suwonStates = mock.saves.filter((args) => args[1] === "suwon");
  assert.equal(result.discovered, 25);
  assert.equal(suwonStates.length, 25);
  assert.deepEqual(
    suwonStates.map((args) => args[8]),
    ["4000", "4020", "4001", "4021", "4002", "4022", "4003", "4023", "4004", "4024", "4005", "4025", "4006", "4026", "4007", "4027", "4008", "4028", "4009", "4029", "4010", "4030", "4011", "4012", "4013"],
  );
});


test("municipal official fetch retries one transient network failure and records a healthy source outcome", async () => {
  const mock = createMockDb();
  let pajuFetches = 0;
  const result = await withFetch((url) => {
    if (url === sourceUrls.paju) {
      pajuFetches += 1;
      if (pajuFetches === 1) throw new TypeError("fetch failed");
      return pajuList();
    }
    if (url === "https://tour.paju.go.kr/detail/940")
      return "2026 문산거리축제 행사 상세";
    return emptySourcePage(url);
  }, () => runMunicipalAutonomous(productionEnv(mock.db)));

  assert.equal(pajuFetches, 2);
  assert.deepEqual(
    result.source_outcomes.find((item) => item.source === "paju"),
    { source: "paju", status: "ok", candidates: 1 },
  );
});

test("municipal official fetch retries transient HTTP failures and persists a bounded reason when both attempts fail", async () => {
  const mock = createMockDb();
  let pajuFetches = 0;
  const result = await withFetch((url) => {
    if (url === sourceUrls.paju) {
      pajuFetches += 1;
      return new Response("unavailable", { status: 503 });
    }
    return emptySourcePage(url);
  }, () => runMunicipalAutonomous(productionEnv(mock.db)));

  assert.equal(pajuFetches, 2);
  assert.deepEqual(
    result.source_outcomes.find((item) => item.source === "paju"),
    {
      source: "paju",
      status: "error",
      candidates: 0,
      reason: "official_http_503",
    },
  );
});

test("municipal source/detail fetch falls back to allowed www sibling after 522", async () => {
  const mock = createMockDb();
  const listUrl =
    "https://ui4u.go.kr/portal/eventNoti/list.do?mId=0301170300";
  const wwwListUrl =
    "https://www.ui4u.go.kr/portal/eventNoti/list.do?mId=0301170300";
  const detailUrl =
    "https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016";
  const wwwDetailUrl =
    "https://www.ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016";
  const seen = [];

  const result = await withFetch((url) => {
    seen.push(url);
    if (url === listUrl || url === detailUrl)
      return new Response("upstream timeout", { status: 522 });
    if (url === wwwListUrl)
      return `
        <h1>2026년 연간 행사·축제 일정</h1>
        <table>
          <tr>
            <th>번호</th><th>분야</th><th>제목</th><th>시작일</th>
            <th>종료일</th><th>장소</th><th>담당부서</th>
          </tr>
          <tr>
            <td>378</td><td>축제</td>
            <td><a href="#" onclick="fnView('2016'); return false;">제9회 동오마을축제 「2026 동오마을 푸드페스타」 개최</a></td>
            <td>2026-10-03</td><td>2026-10-03</td>
            <td>동오마을 공영주차장 일원(경전철 동오역 인근)</td>
            <td>의정부도시공사 상권진흥센터</td>
          </tr>
        </table>
      `;
    if (url === wwwDetailUrl)
      return `
        <h1>제9회 동오마을축제 「2026 동오마을 푸드페스타」 개최</h1>
        <p>일시: 2026. 10. 3.(토) 12:00 ~ 19:00</p>
        <p>장소: 동오마을 공영주차장 일원(경전철 동오역 인근)</p>
        <img src="/upload/food-festa.jpg" width="900" height="1200" alt="동오마을 푸드페스타 포스터">
      `;
    return emptySourcePage(url);
  }, () =>
    runMunicipalAutonomous(productionEnv(mock.db), {
      sourceKeys: ["gyeonggi-의정부"],
      maxPublishMutations: 3,
      maxRetryCandidates: 4,
      maxDetailFetches: 22,
      maxExternalFetches: 35,
    }),
  );

  assert.equal(
    result.source_outcomes.find((item) => item.source === "gyeonggi-의정부")
      ?.status,
    "ok",
  );
  assert.ok(seen.includes(listUrl));
  assert.ok(seen.includes(wwwListUrl));
  assert.ok(seen.includes(detailUrl));
  assert.ok(seen.includes(wwwDetailUrl));
});
