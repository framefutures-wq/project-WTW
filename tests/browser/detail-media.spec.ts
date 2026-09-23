import { expect, test } from "@playwright/test";

const event = (id: string, secondary: string) => ({
  id,
  title: `상세 미디어 ${id}`,
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
  image_url: "https://tong.visitkorea.or.kr/detail-main.svg",
  image_status: "ok",
  tags: ["experience"],
  distance_km: null,
  secondary,
});

const detail = (id: string, secondary: string) => ({
  event: event(id, secondary),
  evidence: [],
  enrichment: null,
  operating_hours: [],
  contact_phone: null,
  images: [
    {
      image_url: "https://tong.visitkorea.or.kr/detail-main.svg",
      source_type: "tourapi",
      source_page_url: null,
      is_primary: true,
      sort_order: 1,
    },
    {
      image_url: secondary,
      source_type: "tourapi",
      source_page_url: null,
      is_primary: false,
      sort_order: 2,
    },
  ],
});

test("two-image detail keeps the secondary image whole with a backdrop", async ({ page }) => {
  const portrait = "https://tong.visitkorea.or.kr/detail-secondary-portrait.svg";
  const landscape = "https://tong.visitkorea.or.kr/detail-secondary-landscape.svg";
  await page.route("**/api/events/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop()!;
    return route.fulfill({
      json: detail(id, id.includes("portrait") ? portrait : landscape),
    });
  });
  await page.route("**/api/meta", (route) =>
    route.fulfill({ json: { available_date_range: null } }),
  );
  await page.route("**/api/events?*", (route) =>
    route.fulfill({
      json: {
        events: [],
        total: 0,
        page: 1,
        limit: 20,
        range: { start: "2026-09-25", end: "2026-09-26" },
        available_date_range: null,
        range_outside_available: false,
        mode: "mock",
      },
    }),
  );
  await page.route("https://tong.visitkorea.or.kr/detail-main.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"/>',
    }),
  );
  await page.route(portrait, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1000"/>',
    }),
  );
  await page.route(landscape, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"/>',
    }),
  );

  for (const id of ["portrait", "landscape"]) {
    await page.goto(`/events/${id}`);
    await expect(page.locator(".detail-media-pair")).toBeVisible();
    const media = await page.locator(".detail-media-pair").evaluate((pair) => {
      const secondary = pair.querySelector(".detail-media-secondary")!;
      const foreground = secondary.querySelector<HTMLImageElement>(
        ".scene-image-foreground",
      )!;
      return {
        objectFit: getComputedStyle(foreground).objectFit,
        backdropCount: secondary.querySelectorAll(".scene-image-backdrop").length,
        naturalWidth: foreground.naturalWidth,
        naturalHeight: foreground.naturalHeight,
        width: foreground.clientWidth,
        height: foreground.clientHeight,
      };
    });
    expect(media.objectFit).toBe("contain");
    expect(media.backdropCount).toBe(1);
    expect(media.naturalWidth).toBeGreaterThan(0);
    expect(media.naturalHeight).toBeGreaterThan(0);
    expect(media.width).toBeGreaterThan(0);
    expect(media.height).toBeGreaterThan(0);
  }
});
