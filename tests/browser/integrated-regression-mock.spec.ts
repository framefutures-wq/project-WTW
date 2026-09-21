import { test, expect } from "@playwright/test";

test.use({ baseURL: "http://127.0.0.1:4174" });

const event = (id: number) => ({
  id: `mock-${id}`,
  title: `통합 QA 행사 ${id}`,
  description: "공식 테스트 행사입니다.",
  region: id % 2 ? "서울" : "경기",
  venue: `테스트 장소 ${id}`,
  address: "서울특별시 테스트구",
  start_date: "2026-09-19",
  end_date: "2026-09-20",
  lat: 37.5665,
  lng: 126.978,
  cost: "unknown",
  price_text: null,
  pet_policy: "unknown",
  status: "scheduled",
  verification: "verified",
  is_sample: 0,
  checked_at: "2026-09-18T00:00:00Z",
  source_url: "https://example.com/event",
  source_name: "테스트 공식 출처",
  source_kind: "event_official",
  trust_status: "confirmed",
  trust_checked_at: "2026-09-18T00:00:00Z",
  trust_source_url: "https://example.com/event",
  trust_source_types: ["event_official"],
  trust_changed_fields: [],
  image_url: null,
  image_status: "missing",
  tags: [],
  distance_km: null,
});

function response(page: number, limit: number, total: number) {
  const start = (page - 1) * limit;
  return {
    events: Array.from(
      { length: Math.max(0, Math.min(limit, total - start)) },
      (_, i) => event(start + i + 1),
    ),
    total,
    page,
    limit,
    range: { start: "2026-09-19", end: "2026-09-20" },
    available_date_range: { start: "2026-09-01", end: "2026-10-31" },
    range_outside_available: false,
    mode: "mock",
  };
}

function detailResponse() {
  return {
    event: event(1),
    evidence: [],
    enrichment: null,
    operating_hours: [],
    contact_phone: null,
  };
}

async function mockDetailRoutes(page: import("@playwright/test").Page) {
  await page.route("**/api/meta", (route) =>
    route.fulfill({ json: { available_date_range: null } }),
  );
  await page.route("**/api/events/*", (route) =>
    route.fulfill({ json: detailResponse() }),
  );
  await page.route("**/api/events?*", (route) =>
    route.fulfill({
      json: response(1, 9, 1),
    }),
  );
}

test("canonical and legacy detail URLs open safely and return to the list", async ({
  page,
}) => {
  await mockDetailRoutes(page);
  await page.goto("/events/mock-1");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL(/\/events\/mock-1$/);
  await page.getByRole("button", { name: "닫기" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page).toHaveURL(/\/\?period=weekend$/);
  await page.goto("/?event=mock-1&period=weekend");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL(/\/events\/mock-1$/);
});

test("필터·더보기·다음 묶음·상세 왕복을 한 흐름으로 복원한다", async ({
  page,
}) => {
  const calls: string[] = [];
  await page.route("**/api/meta", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        available_date_range: { start: "2026-09-01", end: "2026-10-31" },
      }),
    }),
  );
  await page.route("**/api/events/*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(detailResponse()),
    }),
  );
  await page.route("**/api/events?*", (route) => {
    const url = new URL(route.request().url());
    const pageNumber = Number(url.searchParams.get("page") ?? 1);
    const total = url.searchParams.get("theme") === "experience" ? 7 : 120;
    calls.push(`${url.searchParams.get("theme") ?? "all"}:${pageNumber}`);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response(pageNumber, 9, total)),
    });
  });

  await page.goto("/");
  await expect(page.locator(".event-card")).toHaveCount(9);
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "9개 더 보기" }).click();
  await expect(page.locator(".event-card")).toHaveCount(36);
  await expect(page.getByRole("region", { name: "탐색 전환" })).toBeVisible();

  await page.getByRole("button", { name: "다른 카테고리를 볼까요?" }).click();
  await expect(
    page.getByRole("button", { name: "모두", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "체험", exact: true }).click();
  await expect(page.locator(".event-card")).toHaveCount(7);
  expect(calls.at(-1)).toBe("experience:1");

  await page.getByRole("button", { name: "모두", exact: true }).click();
  await expect(page.locator(".event-card")).toHaveCount(9);
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "9개 더 보기" }).click();
  await page.getByRole("button", { name: "다음 행사 보기" }).click();
  await expect(page.locator(".event-card")).toHaveCount(9);
  await expect(page.locator(".event-card").first()).toContainText("행사 37");
  await page.getByRole("button", { name: /통합 QA 행사 37 상세 보기/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL(/\/events\/mock-37$/);
  const beforeBack = calls.length;
  await page.goBack();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page).not.toHaveURL(/\/events\//);
  await expect(page.locator(".event-card").first()).toContainText("행사 37");
  expect(calls.length).toBe(beforeBack);
});

test("추가 페이지 실패는 기존 카드와 retry를 보존한다", async ({ page }) => {
  let pageThreeAttempts = 0;
  await page.route("**/api/meta", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ available_date_range: null }),
    }),
  );
  await page.route("**/api/events/*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(detailResponse()),
    }),
  );
  await page.route("**/api/events?*", (route) => {
    const url = new URL(route.request().url());
    const pageNumber = Number(url.searchParams.get("page") ?? 1);
    if (pageNumber === 3 && pageThreeAttempts++ === 0)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "temporary" }),
      });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response(pageNumber, 9, 36)),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "9개 더 보기" }).click();
  await page.getByRole("button", { name: "9개 더 보기" }).click();
  await expect(page.locator(".event-card")).toHaveCount(18);
  await expect(page.getByRole("alert")).toContainText(
    "추가 행사를 불러오지 못했어요",
  );
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.locator(".event-card")).toHaveCount(27);
  expect(pageThreeAttempts).toBe(2);
});
