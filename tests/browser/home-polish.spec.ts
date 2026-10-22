import { expect, test } from "@playwright/test";

const event = (id: string, title: string, image_url: string | null) => ({
  id,
  title,
  description: "공식 테스트 행사입니다.",
  region: "서울",
  venue: "테스트 장소",
  address: "서울특별시 테스트구",
  start_date: "2026-10-11",
  end_date: "2026-10-11",
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

test("home gives the lead recommendation visual priority before its utilities", async ({
  page,
}) => {
  const width = page.viewportSize()!.width;
  await page.setViewportSize({
    width: width >= 760 ? 1440 : 390,
    height: width >= 760 ? 900 : 844,
  });
  const photoUrl =
    "https://tong.visitkorea.or.kr/cms/resource/65/4109965_image2_1.jpg";
  const posterUrl =
    "https://tong.visitkorea.or.kr/cms/resource/56/4114556_image2_1.jpg";
  const events = [
    event("landscape", "정상 가로 사진 행사", photoUrl),
    event("poster", "정상 포스터 행사", posterUrl),
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
  await page.route("**/api/events?period=weekend**", (route) =>
    route.fulfill({
      json: {
        events,
        total: events.length,
        page: 1,
        limit: 20,
        range: { start: "2026-10-11", end: "2026-10-11" },
        available_date_range: null,
        range_outside_available: false,
        mode: "mock",
      },
    }),
  );
  await page.goto("/");
  await expect(page.getByText("이번 주말 추천", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "더 둘러보기", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".event-card", { hasText: "이미지 없는 행사" })
      .locator(".card-info-graphic"),
  ).toBeVisible();
  const noImageCard = page.locator(".event-card", { hasText: "이미지 없는 행사" });
  const fallbackArt = noImageCard.locator(".card-info-graphic-art");
  await expect(fallbackArt).toBeVisible();
  await expect
    .poll(() => fallbackArt.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await expect(noImageCard.locator(".card-info-graphic-label")).toBeVisible();
  await expect(noImageCard.locator(".card-info-graphic-symbol")).toHaveCount(0);
  await expect(noImageCard.locator(".card-info-graphic-brand")).toBeVisible();

  const layout = await page.evaluate(() => {
    const featured = document.querySelector<HTMLElement>(".featured-composition")!;
    const title = document.querySelector<HTMLElement>(".event-card h3")!;
    return {
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      columns: getComputedStyle(featured)
        .gridTemplateColumns.trim()
        .split(/\s+/).length,
      featuredDisplay: getComputedStyle(featured).display,
      allEventColumns: getComputedStyle(
        document.querySelector<HTMLElement>(
          ".all-events-section .event-grid",
        )!,
      )
        .gridTemplateColumns.trim()
        .split(/\s+/).length,
      featuredBeforeControls:
        featured.getBoundingClientRect().top <
        document.querySelector<HTMLElement>(".decision-bar")!.getBoundingClientRect().top,
      titleWeight: Number(getComputedStyle(title).fontWeight),
    };
  });

  expect(layout.overflow).toBe(false);
  expect(layout.featuredBeforeControls).toBe(true);
  expect(layout.titleWeight).toBeGreaterThanOrEqual(700);
  if (page.viewportSize()!.width >= 760) {
    expect(layout.columns).toBe(2);
    expect(layout.featuredDisplay).toBe("grid");
    expect(layout.allEventColumns).toBe(4);
  } else {
    expect(layout.featuredDisplay).toBe("flex");
    expect(layout.allEventColumns).toBe(2);
  }

  const firstScene = page.locator(".event-card .scene").first();
  const firstFeaturedCard = page.locator(".featured-composition .feature-primary");
  const firstTitle = firstFeaturedCard.locator(".card-content h3");
  const firstDate = firstFeaturedCard.locator(".event-date");
  for (const element of [firstScene, firstTitle, firstDate]) {
    const box = await element.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height + 1,
    );
  }

  const hero = await page.locator(".hero").boundingBox();
  const controls = await page.locator(".decision-bar").boundingBox();
  expect(hero).not.toBeNull();
  expect(controls).not.toBeNull();
  if (page.viewportSize()!.width >= 760) {
    const featuredBox = await firstFeaturedCard.boundingBox();
    expect(featuredBox).not.toBeNull();
    expect(controls!.y).toBeGreaterThan(featuredBox!.y);
  }
  const sceneBox = await firstScene.boundingBox();
  expect(sceneBox).not.toBeNull();
  expect(sceneBox!.width / sceneBox!.height).toBeCloseTo(
    page.viewportSize()!.width >= 760 ? 1.6 : 4 / 3,
    1,
  );
  await page.screenshot({
    path: `test-results/ui-ci/home-first-viewport-${page.viewportSize()!.width >= 760 ? "desktop" : "mobile"}.png`,
  });
  await noImageCard.locator(".scene").screenshot({
    path: `test-results/ui-ci/no-image-card-${width >= 760 ? "desktop" : "mobile"}.png`,
  });
});

test("home header keeps region and category controls readable at mobile and desktop widths", async ({ page }) => {
  const width = page.viewportSize()!.width;
  await page.setViewportSize({ width: width >= 760 ? 1440 : 390, height: width >= 760 ? 900 : 844 });
  await page.goto("/");

  const category = page.locator(".category-quick-trigger");
  const region = page.locator(".region-quick-trigger");
  const about = page.locator(".trust-link");
  await expect(category).toBeVisible();
  await expect(category.locator("span")).toHaveText("카테고리");
  await expect(region).toBeVisible();
  await expect(about).toBeVisible();

  const boxes = await Promise.all([category, region, about].map((locator) => locator.boundingBox()));
  expect(boxes.every(Boolean)).toBe(true);
  const [categoryBox, regionBox, aboutBox] = boxes as NonNullable<(typeof boxes)[number]>[];
  expect(categoryBox.x).toBeGreaterThanOrEqual(0);
  expect(categoryBox.x + categoryBox.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(categoryBox.x).toBeGreaterThanOrEqual(regionBox.x + regionBox.width);
  expect(categoryBox.x + categoryBox.width).toBeLessThanOrEqual(aboutBox.x);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
