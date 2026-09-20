import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runMunicipalDiscovery } from "../scripts/municipal-discover.mjs";

test("dry-run marks existing municipal events duplicate, skips EXCLUDE detail, and readies only NEW candidates", async () => {
  const calls = [];
  const report = await runMunicipalDiscovery({
    fetchOfficialPage: async (url, _cache, metrics) => {
      calls.push(url); metrics.official_requests += 1;
      if (url.includes("BD_index")) return readFileSync("fixtures/municipal-discovery-paju.html", "utf8");
      if (url === "https://www.swcf.or.kr/?p=29") return readFileSync("fixtures/municipal-discovery-suwon.html", "utf8");
      if (url.includes("goyang.go.kr/visitgoyang/www/contents.do?key=595")) return readFileSync("fixtures/municipal-discovery-goyang.html", "utf8");
      if (url.includes("tour.hscity.go.kr/NEW/6festival/festival5.jsp")) return readFileSync("fixtures/municipal-discovery-hwaseong.html", "utf8");
      if (url.includes("cultMstSn=940")) return "2026년 제18회 문산거리축제 운영시간 12:00~21:00";
      if (url.includes("cultMstSn=941")) return "2026년 제11회 심학산 둘레길 축제 공식 상세";
      return "공식 상세";
    },
    execute: (sql) => ({ results: sql.includes("문산거리축제") && sql.includes("WHERE title") ? [{ id: "municipal-paju-munsan-street-2026" }] : [], meta: { rows_read: 1 } }),
  });
  const munsan = report.candidates.find((item) => item.title.includes("문산거리축제"));
  const excluded = report.candidates.find((item) => item.title.includes("교육·문화"));
  const simhaksan = report.candidates.find((item) => item.title.includes("심학산"));
  assert.equal(munsan?.duplicate_status, "DUPLICATE");
  assert.equal(excluded?.selection_gate, "EXCLUDE");
  assert.equal(calls.includes(excluded.official_url), false);
  assert.equal(simhaksan?.ready_for_review, true);
  assert.equal(report.summary.d1_rows_written, 0);
});
