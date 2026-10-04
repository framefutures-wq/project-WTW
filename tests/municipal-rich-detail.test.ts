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
  assert.deepEqual(
    rich.images.map((image) => image.url),
    ["https://festival.example.go.kr/event/poster.jpg"],
  );
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
  assert.deepEqual(
    rich.images.map((image) => image.url),
    ["https://www.swcf.or.kr/upload/event/sumunjang-poster.jpg"],
  );
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
  assert.deepEqual(
    rich.operating_hours.map((row) => [row.start_time, row.end_time]),
    [["12:00", "19:00"]],
  );
  assert.deepEqual(rich.programs, []);
});

test("extracts Paju-style exhibition essay, hours, and docent without metadata programs or site boilerplate", () => {
  const rich = extractMunicipalRichDetail(
    "https://tour.paju.go.kr/user/link/cultural/BD_selectCulturalView.do?cultMstSn=947",
    `
      <meta name="description" content="파주시의 다양한 문화행사를 만나보세요.">
      <footer><p>파주시 문화관광 공식 홈페이지</p></footer>
      <table>
        <tr><th>행사기간</th><td>2026-10-08 ~ 2026-11-29</td></tr>
        <tr><th>행사시간</th><td>10: 00~17: 00</td></tr>
        <tr><th>행사장소</th><td>평화뮤지엄 S827</td></tr>
        <tr><th>문의하기</th><td>031-950-8435</td></tr>
      </table>
      <div class="detail_view_area">
        <div><span style="font-weight:bold">기간</span><br>2026. 10. 8. ~ 2026. 11. 29.<br>
        <span style="font-weight:bold">전시서문</span><br>
        파주문화재단은 이번 기획전시에서 공간과 예술가, 작품과 관람객의 관계를 살펴봅니다.<br>
        <span style="font-weight:bold">학생선정작</span><br>지역 고등학생 작품을 함께 선보입니다.<br>
        평일 09:00~19:00<br>
        대표전화 031-950-8435<br>
        <span style="font-weight:bold">전시연계 프로그램</span><br>
        <span style="font-weight:bold">| 도슨트 프로그램</span><br>
        - 일시: 매주 토요일 11:00~17:00<br>
        - 전시와 작품 해설을 함께하는 관람 프로그램입니다.
        </div>
      </div>
    `,
  );

  assert.equal(
    rich.summary,
    "파주문화재단은 이번 기획전시에서 공간과 예술가, 작품과 관람객의 관계를 살펴봅니다.",
  );
  assert.deepEqual(
    rich.operating_hours.map(({ start_time, end_time }) => [
      start_time,
      end_time,
    ]),
    [["10:00", "17:00"]],
  );
  assert.equal(rich.contact_phone, "031-950-8435");
  assert.deepEqual(
    rich.programs.map(({ name }) => name),
    ["도슨트 프로그램"],
  );
  assert.match(rich.programs[0]?.description ?? "", /전시와 작품 해설/);
  assert.equal(
    rich.programs.some(({ name }) => /평일|대표전화/.test(name)),
    false,
  );
  assert.doesNotMatch(rich.summary ?? "", /공식 홈페이지|지역 고등학생/);
});

test("splits an explicit Paju-style comma-separated program list without absorbing promotion copy", () => {
  const rich = extractMunicipalRichDetail(
    "https://tour.example.go.kr/event/948",
    `
      <div class="detail_view_area">
        <div class="f14">
          파주가 낳은 율곡 이이 선생의 유덕을 추앙하기 위한 제36회 율곡문화제가 개최됩니다.<br>
          ○ 주요 프로그램 : 유가행렬, 추향제, 문화예술공연, 전통문화 체험 등
        </div>
        <div class="img-wrap"><div class="ir-desc">홍보 포스터 및 기관 안내</div></div>
      </div>
    `,
  );

  assert.deepEqual(
    rich.programs,
    ["유가행렬", "추향제", "문화예술공연", "전통문화 체험"].map((name) => ({
      name,
      description: null,
      schedule_text: null,
    })),
  );
  assert.equal(
    rich.programs.some((program) => /홍보|안내|주요 프로그램/.test(program.name)),
    false,
  );
});

test("splits a structured program list into individual Paju-style programs", () => {
  const rich = extractMunicipalRichDetail(
    "https://tour.example.go.kr/event/946",
    `
      <div class="detail_view_area">
        <p><strong>○ 주요 프로그램</strong></p>
        <ul>
          <li>* 탄현면 주민자치회 <strong>삼도품 축제</strong></li>
          <li>* 국립민속박물관 파주 <strong>전시·체험·교육 프로그램</strong></li>
          <li>* 국립극장 무대예술지원센터 <strong>전시·체험 및 공연</strong></li>
        </ul>
        <p><strong>○ 문의:</strong> 031-940-8516</p>
      </div>
    `,
  );

  assert.deepEqual(
    rich.programs.map((program) => [program.name, program.description]),
    [
      ["탄현면 주민자치회 삼도품 축제", null],
      ["국립민속박물관 파주 전시·체험·교육 프로그램", null],
      ["국립극장 무대예술지원센터 전시·체험 및 공연", null],
    ],
  );
  assert.equal(rich.programs.some((program) => program.name === "주요 프로그램"), false);
  assert.equal(rich.programs.some((program) => /문의/.test(program.name)), false);
});

test("extracts inline label-value detail safely and keeps closure rules intact", () => {
  const rich = extractMunicipalRichDetail(
    "https://www.gyeongju.go.kr/tour/page.do?con_uid=fixture",
    `
      <html><body>
        <div class="bottom festival">
          <div class="detail">
            전시일정 ｜ 2026. 6. 30. ~ 2026. 10. 18.<br>
            관람시간 ｜ 10:00-18:00(입장마감 17:30)<br>
            * 매주 월요일 휴관. 단, 공휴일이 월요일인 경우 정상개관하며 다음 평일 휴관<br>
            전시장소 ｜ 경주예술의전당 알천미술관<br>
            관 람 료 ｜ 성인 10,000원 / 어린이 및 청소년 7,000원<br>
            관람할인 ｜ 경주시민 5,000원<br>
            관람문의 ｜ 054-777-5823<br>
            도슨트 프로그램 ｜ 10:30 / 12:30 / 14:00 / 16:00<br>
            * 회차별 30명 현장 선착순 진행(수신기 대여)<br>
            ※ 오디오도슨트는 개인휴대폰 QR코드로 이용가능<br>
          </div>
        </div>
        <footer>
          <p>대표전화054-779-8585 (평일 09:00~18:00)</p>
          <p>경주시 관광 안내 정보를 확인하세요.</p>
        </footer>
      </body></html>
    `,
  );

  assert.equal(rich.contact_phone, "054-777-5823");
  assert.equal(rich.price_text, "성인 10,000원 / 어린이 및 청소년 7,000원");
  assert.deepEqual(rich.operating_hours, []);
  assert.deepEqual(
    rich.programs.map(({ name }) => name),
    ["도슨트 프로그램"],
  );
  assert.equal(rich.programs[0]?.schedule_text, "10:30, 12:30, 14:00, 16:00");
  assert.match(rich.programs[0]?.description ?? "", /회차별 30명 현장 선착순/);
  assert.doesNotMatch(rich.programs[0]?.description ?? "", /오디오도슨트/);
  assert.equal(rich.summary, null);
  assert.doesNotMatch(rich.price_text ?? "", /안내/);
  assert.equal(
    rich.programs.some(({ name }) => /관람시간|대표전화/.test(name)),
    false,
  );
});

test("rich text removes scripts and preserves block boundaries", () => {
  assert.equal(
    municipalRichText(
      "<p>첫 문장</p><script>alert(1)</script><p>둘째 문장</p>",
    ),
    "첫 문장\n둘째 문장",
  );
});
