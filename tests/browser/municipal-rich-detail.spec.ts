import { expect, test } from "@playwright/test";

test("municipal rich detail is actually visible in the event modal", async ({ page }) => {
  const id = "municipal-seoul-hangang-ui";
  const image1 = "https://galteum.com/api/events/municipal-seoul-hangang-ui/image/1";
  const image2 = "https://galteum.com/api/events/municipal-seoul-hangang-ui/image/2";

  const event = {
    id,
    title: "달빛 한가위 마당 (차없는 잠수교 뚜벅뚜벅 축제)",
    description: "공식 지자체 행사 안내를 바탕으로 등록된 행사입니다.",
    region: "서울",
    venue: "반포한강공원 잠수교 달빛광장",
    address: "반포한강공원 잠수교 달빛광장",
    start_date: "2026-09-27",
    end_date: "2026-09-27",
    lat: null,
    lng: null,
    cost: "free",
    price_text: "무료",
    pet_policy: "unknown",
    status: "scheduled",
    verification: "verified",
    is_sample: 0,
    checked_at: "2026-09-27T06:00:00.000Z",
    source_url:
      "https://hangang.seoul.go.kr/www/eventMng/detail.do?mid=538&srchType=list&evntSn=462",
    source_name: "서울 한강 공식 행사 안내",
    source_kind: "municipality",
    trust_status: null,
    trust_checked_at: null,
    trust_source_url: null,
    trust_source_types: [],
    trust_changed_fields: [],
    image_url: image1,
    image_status: "ok",
    tags: ["experience"],
    distance_km: null,
    operating_hours: null,
  };

  await page.route("**/api/events/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/image/1") || url.pathname.endsWith("/image/2")) {
      return route.fulfill({
        contentType: "image/svg+xml",
        body:
          '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="white"/></svg>',
      });
    }
    return route.fulfill({
      json: {
        event,
        evidence: [],
        contact_phone: { display: "120", href: "tel:120" },
        operating_hours: [
          {
            start_date: "2026-09-27",
            end_date: "2026-09-27",
            start_time: "15:00",
            end_time: "16:00",
            human_time_text: "15:00~16:00, 17:00~18:00",
          },
          {
            start_date: "2026-09-27",
            end_date: "2026-09-27",
            start_time: "17:00",
            end_time: "18:00",
            human_time_text: "15:00~16:00, 17:00~18:00",
          },
        ],
        enrichment: {
          summary:
            "6개국 전통 공연과 한복 대여, 전통놀이 체험을 즐길 수 있습니다.",
          source_url: event.source_url,
          source_kind: "municipality",
          source_priority: 2,
          highlights: [],
          programs: [
            {
              name: "6개국 전통 공연",
              date: null,
              start_time: null,
              end_time: null,
              schedule_text: "15:00, 17:00",
              venue: null,
              description: "6개국 전통 공연 프로그램입니다.",
              featured: false,
              tags: [],
              occurrences: [],
            },
            {
              name: "한복 대여",
              date: null,
              start_time: null,
              end_time: null,
              schedule_text: null,
              venue: null,
              description: "한복을 직접 입어보는 체험입니다.",
              featured: false,
              tags: [],
              occurrences: [],
            },
            {
              name: "전통놀이 체험",
              date: null,
              start_time: null,
              end_time: null,
              schedule_text: null,
              venue: null,
              description: "전통놀이 체험 프로그램입니다.",
              featured: false,
              tags: [],
              occurrences: [],
            },
          ],
        },
        images: [
          {
            image_url: image1,
            source_type: "municipality",
            source_page_url: event.source_url,
            is_primary: true,
            sort_order: 1,
          },
          {
            image_url: image2,
            source_type: "municipality",
            source_page_url: event.source_url,
            is_primary: false,
            sort_order: 2,
          },
        ],
        mode: "production",
      },
    });
  });

  await page.route("**/api/meta", (route) =>
    route.fulfill({
      json: {
        available_date_range: {
          start: "2026-09-01",
          end: "2026-12-31",
        },
      },
    }),
  );
  await page.route("**/api/events?*", (route) =>
    route.fulfill({
      json: {
        events: [],
        total: 0,
        page: 1,
        limit: 20,
        range: { start: "2026-09-27", end: "2026-09-27" },
        available_date_range: {
          start: "2026-09-01",
          end: "2026-12-31",
        },
        range_outside_available: false,
        mode: "production",
      },
    }),
  );

  await page.goto("/events/" + encodeURIComponent(id));

  await expect(page.getByText("6개국 전통 공연과 한복 대여, 전통놀이 체험을 즐길 수 있습니다.")).toBeVisible();
  await expect(page.getByText("15:00 ~ 16:00 · 17:00 ~ 18:00")).toBeVisible();
  await expect(page.getByText("120", { exact: true })).toBeVisible();
  await expect(page.getByText("6개국 전통 공연", { exact: true })).toBeVisible();
  await expect(page.getByText("한복 대여", { exact: true })).toBeVisible();
  await expect(page.getByText("전통놀이 체험", { exact: true })).toBeVisible();

  const media = page.locator(".detail-media-pair");
  await expect(media).toBeVisible();
  await expect(media.locator(".scene-image-foreground")).toHaveCount(2);
  const loaded = await media.locator(".scene-image-foreground").evaluateAll((images) =>
    images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
  );
  expect(loaded).toBe(true);
});
