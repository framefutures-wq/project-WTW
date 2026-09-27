import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyRichDetailCoverage,
  detectRichDetailSignals,
  richSignalNames,
} from "../scripts/audit-municipal-rich-detail.mjs";

test("rich-detail audit detects the Seoul Hangang-style official detail signals", () => {
  const html = `
    <main>
      <img src="/upload/event/poster.jpg" alt="달빛 한가위 마당">
      <img src="/upload/event/performance.jpg" alt="공연 사진">
      <h1>달빛 한가위 마당</h1>
      <dl>
        <dt>시간</dt><dd>2026. 9. 27.(일) 15:00~16:00, 17:00~18:00</dd>
        <dt>이용료</dt><dd>무료</dd>
        <dt>장소</dt><dd>반포한강공원 잠수교 달빛광장</dd>
        <dt>문의</dt><dd>120</dd>
      </dl>
      <h2>상세내용</h2>
      <p>6개국 전통 공연과 한복 대여, 전통놀이 체험 프로그램을 운영합니다.</p>
    </main>
  `;
  const signals = detectRichDetailSignals(html);

  assert.equal(signals.images, true);
  assert.equal(signals.multiple_images, true);
  assert.equal(signals.time, true);
  assert.equal(signals.price, true);
  assert.equal(signals.phone, true);
  assert.equal(signals.intro, true);
  assert.equal(signals.programs, true);
  assert.deepEqual(
    richSignalNames(signals),
    ["images", "time", "price", "phone", "intro", "programs"],
  );
});

test("rich-detail audit ignores decorative logo/icon images", () => {
  const signals = detectRichDetailSignals(`
    <html><body>
      <img src="/assets/logo.png">
      <img src="/assets/icon-calendar.svg">
      <p>행사 목록</p>
    </body></html>
  `);

  assert.equal(signals.images, false);
  assert.equal(signals.image_count, 0);
});

test("coverage classification distinguishes rich, moderate, and absent detail", () => {
  assert.equal(
    classifyRichDetailCoverage({
      detailSampleCount: 2,
      detailFetchFailures: 0,
      observedFields: ["images", "time", "price", "intro"],
    }),
    "RICH_DETAIL_UNHARVESTED",
  );

  assert.equal(
    classifyRichDetailCoverage({
      detailSampleCount: 1,
      detailFetchFailures: 0,
      observedFields: ["time"],
    }),
    "DETAIL_FIELDS_UNHARVESTED",
  );

  assert.equal(
    classifyRichDetailCoverage({
      detailSampleCount: 0,
      detailFetchFailures: 0,
      observedFields: [],
    }),
    "NO_DETAIL_SAMPLE",
  );

  assert.equal(
    classifyRichDetailCoverage({
      detailSampleCount: 1,
      detailFetchFailures: 1,
      observedFields: [],
    }),
    "DETAIL_FETCH_FAILED",
  );
});
