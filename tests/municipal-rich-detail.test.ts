import assert from "node:assert/strict";
import test from "node:test";
import {
  extractMunicipalRichDetail,
  municipalRichText,
} from "../shared/municipal-rich-detail";

test("extracts Seoul Hangang-style official rich detail without guessing", () => {
  const html = `
    <html>
      <head>
        <meta property="og:image" content="/uploads/moon-main.jpg">
      </head>
      <body>
        <dl>
          <dt>기 간</dt><dd>2026-09-27 ~ 2026-09-27</dd>
          <dt>시 간</dt><dd>2026. 9. 27. 15:00~16:00, 17:00~18:00</dd>
          <dt>이용요금</dt><dd>무료</dd>
          <dt>문 의 처</dt><dd>120</dd>
        </dl>
        <h4>상세내용</h4>
        <p>추석 연휴 마지막 날 반포한강공원에서 달빛 한가위 마당이 열립니다.</p>
        <p>6개국의 전통 의상과 민속 공연, 한복 대여, 전통놀이 체험을 즐길 수 있습니다.</p>

        <h5>세계 전통문화 공연 · 체험</h5>
        <h6>6개국 전통 공연</h6>
        <p>전통 의상과 민속 공연을 15:00, 17:00 두 차례 만날 수 있습니다.</p>
        <h6>한복 대여</h6>
        <p>한복을 직접 입어보는 체험 프로그램입니다.</p>
        <h6>전통놀이 체험</h6>
        <p>가족과 함께 전통놀이를 체험합니다.</p>

        <h5>함께 즐기는 뚜벅뚜벅 축제</h5>
        <img src="/assets/logo.png" width="80" height="40" alt="서울시 로고">
        <img src="/uploads/performance.jpg" width="1200" height="800" alt="전통공연 모습">
        <img src="/uploads/play.jpg" width="1200" height="800" alt="달빛놀이터">
      </body>
    </html>
  `;

  const rich = extractMunicipalRichDetail(
    "https://hangang.seoul.go.kr/www/eventMng/detail.do?evntSn=462",
    html,
  );

  assert.match(rich.summary ?? "", /달빛 한가위 마당/);
  assert.deepEqual(rich.operating_hours, [
    {
      start_time: "15:00",
      end_time: "16:00",
      human_time_text: "2026. 9. 27. 15:00~16:00, 17:00~18:00",
    },
    {
      start_time: "17:00",
      end_time: "18:00",
      human_time_text: "2026. 9. 27. 15:00~16:00, 17:00~18:00",
    },
  ]);
  assert.equal(rich.price_text, "무료");
  assert.equal(rich.contact_phone, "120");
  assert.deepEqual(
    rich.images.map((image) => image.url),
    [
      "https://hangang.seoul.go.kr/uploads/moon-main.jpg",
      "https://hangang.seoul.go.kr/uploads/performance.jpg",
      "https://hangang.seoul.go.kr/uploads/play.jpg",
    ],
  );
  assert.deepEqual(
    rich.programs.map((program) => program.name),
    ["6개국 전통 공연", "한복 대여", "전통놀이 체험"],
  );
  assert.equal(rich.programs[0]?.schedule_text, "15:00, 17:00");
});

test("extracts explicit table labels and rejects off-site body images", () => {
  const html = `
    <table>
      <tr><th>운영시간</th><td>09:30 ~ 18:00</td></tr>
      <tr><th>관람료</th><td>성인 10,000원</td></tr>
      <tr><th>연락처</th><td>031-123-4567</td></tr>
    </table>
    <h3>행사 소개</h3>
    <p>공식 행사 상세 소개가 충분히 제공되는 페이지입니다.</p>
    <img src="https://tracker.example.com/banner.jpg" width="800" height="600">
    <img src="/event/poster.jpg" width="800" height="1000" alt="행사 포스터">
  `;

  const rich = extractMunicipalRichDetail(
    "https://festival.example.go.kr/event/1",
    html,
  );

  assert.equal(rich.operating_hours[0]?.start_time, "09:30");
  assert.equal(rich.operating_hours[0]?.end_time, "18:00");
  assert.equal(rich.price_text, "성인 10,000원");
  assert.equal(rich.contact_phone, "031-123-4567");
  assert.deepEqual(rich.images.map((image) => image.url), [
    "https://festival.example.go.kr/event/poster.jpg",
  ]);
});

test("rich text removes scripts and preserves block boundaries", () => {
  assert.equal(
    municipalRichText(
      "<p>첫 문장</p><script>alert(1)</script><p>둘째 문장</p>",
    ),
    "첫 문장\n둘째 문장",
  );
});
