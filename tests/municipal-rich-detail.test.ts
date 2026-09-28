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

test("extracts current Suwon-style detail while rejecting generic site chrome", () => {
  const html = `
    <html>
      <head>
        <meta property="og:image" content="/inc/img/common/swcf_img.jpg">
      </head>
      <body>
        <h1>수문장 마켓 페스티벌</h1>
        <img src="/inc/img/common/all_menu_show.gif" alt="전체메뉴">
        <img
          src="/upload/event/sumunjang-poster.jpg"
          alt="수원형 문화직거래 마켓 수문장 페스티벌 홍보 이미지"
          width="900"
          height="1200"
        >
        <table>
          <tr><th>기간</th><td>2026-07-11 ~ 2026-10-31</td></tr>
          <tr><th>시간</th><td>9월 16:00~21:00 / 10월 15:00~20:00</td></tr>
          <tr><th>장소</th><td>화홍사랑채 앞 광장</td></tr>
          <tr><th>이용료</th><td>무료</td></tr>
          <tr><th>문의처</th><td>031-290-3583</td></tr>
        </table>
        <h2>행사개요</h2>
        <p>매주 토요일, 우리 동네 로컬 크리에이터를 만나는 공식 문화 직거래 행사입니다.</p>
      </body>
    </html>
  `;
  const rich = extractMunicipalRichDetail(
    "https://www.swcf.or.kr/?idx=3011&p=29_view",
    html,
  );

  assert.match(rich.summary ?? "", /로컬 크리에이터/);
  assert.deepEqual(
    rich.operating_hours.map((row) => [row.start_time, row.end_time]),
    [
      ["16:00", "21:00"],
      ["15:00", "20:00"],
    ],
  );
  assert.equal(rich.price_text, "무료");
  assert.equal(rich.contact_phone, "031-290-3583");
  assert.deepEqual(rich.images.map((image) => image.url), [
    "https://www.swcf.or.kr/upload/event/sumunjang-poster.jpg",
  ]);
});

test("extracts Korean-hour ranges and time-bearing program lines from an exact Hangang page", () => {
  const html = `
    <h1>2026 차 없는 잠수교 뚜벅뚜벅 축제 (하반기)</h1>
    <dl>
      <dt>시간</dt><dd>14시~22시</dd>
      <dt>이용요금</dt><dd>무료</dd>
    </dl>
    <h2>상세내용</h2>
    <p>가을밤 한강에서 즐기는 차 없는 잠수교 축제입니다.</p>
    <p>문화예술공연 1 19:30 ~ 20:30</p>
    <p>드론 라이트 쇼 20:30 ~ 20:45</p>
    <p>문화예술공연 2 20:45 ~ 21:15</p>
  `;
  const rich = extractMunicipalRichDetail(
    "https://hangang.seoul.go.kr/www/eventMng/detail.do?evntSn=451",
    html,
  );

  assert.deepEqual(
    rich.operating_hours.map((row) => [row.start_time, row.end_time]),
    [["14:00", "22:00"]],
  );
  assert.deepEqual(
    rich.programs.map((program) => program.name),
    ["문화예술공연 1", "드론 라이트 쇼", "문화예술공연 2"],
  );
});

test("does not turn site chrome or an event-wide date line into detail content", () => {
  const rich = extractMunicipalRichDetail(
    "https://ui4u.go.kr/portal/eventNoti/view.do?mId=0301170300&idx=2016",
    `
      <meta name="description" content="행복특별시 의정부입니다. 열린민원 서비스와 시정소식 각 분야별 정보를 제공합니다.">
      <main>
        <h1>제9회 동오마을축제 2026 동오마을 푸드페스타</h1>
        <p>□ 일 시: 2026. 10. 3.(토) 12:00 ~ 19:00</p>
      </main>
    `,
  );

  assert.equal(rich.summary, null);
  assert.deepEqual(rich.operating_hours.map((row) => [row.start_time, row.end_time]), [
    ["12:00", "19:00"],
  ]);
  assert.deepEqual(rich.programs, []);
});

test("rich text removes scripts and preserves block boundaries", () => {
  assert.equal(
    municipalRichText(
      "<p>첫 문장</p><script>alert(1)</script><p>둘째 문장</p>",
    ),
    "첫 문장\n둘째 문장",
  );
});
