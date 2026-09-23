import { expect, test } from "@playwright/test";

const event = (id: string, title: string, image_url: string | null) => ({
  id,
  title,
  description: "공식 테스트 행사입니다.",
  region: "서울",
  venue: "테스트 장소",
  address: "서울특별시 테스트구",
  start_date: "2026-09-25",
  end_date: "2026-09-26",
  lat: null,
  lng: null,
  cost: "unknown",
  price_text: null,
  pet_policy: "unknown",
  status: "scheduled",
  verification: "verified",
  is_sample: 0,
  checked_at: null,
  source_url: null,
  source_name: null,
  source_kind: null,
  trust_status: null,
  trust_checked_at: null,
  trust_source_url: null,
  trust_source_types: [],
  trust_changed_fields: [],
  image_url,
  image_status: image_url ? "ok" : "missing",
  tags: ["experience"],
  distance_km: null,
});

test("home keeps a dense four-column desktop grid and a safe mobile structure", async ({
  page,
}) => {
  const photoUrl = "https://tong.visitkorea.or.kr/home-polish.svg";
  const events = [
    event("landscape", "정상 가로 사진 행사", photoUrl),
    event("poster", "정상 포스터 행사", photoUrl),
    event("fallback", "이미지 없는 행사", null),
    event("feature-four", "추천 행사 네 번째", photoUrl),
    event(
      "long-title",
      "긴 행사 제목도 카드 안에서 자연스럽게 읽히는지 확인하는 테스트",
      photoUrl,
    ),
    event("list-two", "더 둘러보기 행사", photoUrl),
    event("list-three", "추가 행사", photoUrl),
    event("list-four", "마지막 행사", photoUrl),
  ];

  await page.route("**/api/meta", (route) =>
    route.fulfill({ json: { available_date_range: null } }),
  );
  await page.route("**/api/events?*", (route) =>
    route.fulfill({
      json: {
        events,
        total: events.length,
        page: 1,
        limit: 20,
        range: { start: "2026-09-25", end: "2026-09-26" },
        available_date_range: null,
        range_outside_available: false,
        mode: "mock",
      },
    }),
  );
  await page.route(photoUrl, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"/>',
    }),
  );

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "이번 주말 먼저 볼 곳" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "더 둘러보기", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".event-card", { hasText: "이미지 없는 행사" })
      .locator(".scene-fallback"),
  ).toBeVisible();

  const layout = await page.evaluate(() => {
    const featured = document.querySelector<HTMLElement>(".featured-grid")!;
    const allEvents = document.querySelector<HTMLElement>(
      ".all-events-section",
    )!;
    const title = document.querySelector<HTMLElement>(".event-card h3")!;
    return {
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      columns: getComputedStyle(featured)
        .gridTemplateColumns.trim()
        .split(/\s+/).length,
      secondSectionDivider: getComputedStyle(allEvents).borderTopWidth,
      titleWeight: Number(getComputedStyle(title).fontWeight),
    };
  });

  expect(layout.overflow).toBe(false);
  expect(layout.secondSectionDivider).toBe("1px");
  expect(layout.titleWeight).toBeGreaterThanOrEqual(700);
  if (page.viewportSize()!.width >= 760) {
    expect(layout.columns).toBe(4);
  } else {
    expect(layout.columns).toBe(2);
  }
});
