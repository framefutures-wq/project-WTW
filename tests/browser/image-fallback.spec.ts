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

test("home cards retain normal images and replace missing or failed images with event information graphics", async ({
  page,
}) => {
  const portraitUrl = "https://tong.visitkorea.or.kr/portrait.svg";
  let portraitRequests = 0;
  await page.route("**/api/meta", (route) =>
    route.fulfill({ json: { available_date_range: null } }),
  );
  await page.route("**/api/events?*", (route) =>
    route.fulfill({
      json: {
        events: [
          event(
            "landscape",
            "정상 가로 이미지",
            "https://tong.visitkorea.or.kr/landscape.svg",
          ),
          { ...event("missing", "기간 행사", null), end_date: "2026-09-27" },
          {
            ...event("portrait", "로드 실패 단일 행사", portraitUrl),
            end_date: "2026-09-25",
          },
        ],
        total: 3,
        page: 1,
        limit: 20,
        range: { start: "2026-09-25", end: "2026-09-26" },
        available_date_range: null,
        range_outside_available: false,
        mode: "mock",
      },
    }),
  );
  await page.route("https://tong.visitkorea.or.kr/landscape.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      headers: { "cache-control": "no-store" },
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"/>',
    }),
  );
  await page.route(portraitUrl, (route) => {
    portraitRequests++;
    return route.abort("failed");
  });

  await page.goto("/");
  const landscape = page
    .locator(".event-card", { hasText: "정상 가로 이미지" })
    .locator(".scene");
  const missing = page
    .locator(".event-card", { hasText: "기간 행사" })
    .locator(".scene");
  const portrait = page
    .locator(".event-card", { hasText: "로드 실패 단일 행사" })
    .locator(".scene");
  await portrait.scrollIntoViewIfNeeded();
  await expect(landscape.locator(".scene-image-foreground")).toBeVisible();
  await expect(missing.locator(".card-info-graphic")).toBeVisible();
  await expect(missing.locator(".card-info-graphic-date")).toHaveText(
    "09.25 — 09.27",
  );
  await expect(missing.locator(".card-info-graphic-meta")).toHaveText(
    "3일간 · 서울",
  );
  await expect(portrait.locator(".card-info-graphic")).toBeVisible();
  await expect(portrait.locator(".card-info-graphic-date")).toHaveText("09.25");
  await expect(portrait.locator(".scene-image")).toHaveCount(0);
  expect(portraitRequests).toBe(1);
});
