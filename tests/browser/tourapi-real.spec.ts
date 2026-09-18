import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  REGIONS,
  AUDIENCES,
  THEMES,
  type EventItem,
  type EventResponse,
  type Period,
} from "../../shared/domain";
const snapshotFile =
  process.env.TEST_REAL_SNAPSHOT ?? ".wrangler/deployment/tourapi-real.json";
function rows(): EventItem[] {
  return JSON.parse(readFileSync(snapshotFile, "utf8")).events;
}
function range(period: Period) {
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
  }).format(new Date());
  if (period === "today") return { start: today, end: today };
  const day = new Date(today + "T00:00:00Z");
  const weekday = day.getUTCDay();
  day.setUTCDate(
    day.getUTCDate() +
      (weekday === 0 ? -1 : 6 - weekday) +
      (period === "next-weekend" ? 7 : 0),
  );
  const start = day.toISOString().slice(0, 10);
  day.setUTCDate(day.getUTCDate() + 1);
  return { start, end: day.toISOString().slice(0, 10) };
}
function expected(period: Period, region = "") {
  const dates = range(period),
    now = Date.now();
  return rows()
    .filter(
      (e) =>
        e.is_sample === 0 &&
        e.verification === "verified" &&
        ["unknown", "scheduled"].includes(e.status) &&
        e.checked_at &&
        Date.parse(e.checked_at) <= now &&
        Date.parse(e.checked_at) >= now - 72 * 3600_000 &&
        e.start_date <= dates.end &&
        e.end_date >= dates.start &&
        (!region || e.region === region),
    )
    .sort(
      (a, b) =>
        a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id),
    );
}
test.beforeEach(async ({ page }) => {
  expect(
    rows().length,
    "실제 TourAPI 원격 D1 스냅샷이 필요합니다.",
  ).toBeGreaterThan(0);
  await page.goto("/");
  await expect(page.locator(".results h2")).toBeVisible();
});
test("실제 데이터 API가 원격 D1 스냅샷 및 날짜·지역 조건과 일치", async ({
  request,
}) => {
  for (const period of ["today", "weekend", "next-weekend"] as const) {
    for (const region of ["", ...REGIONS]) {
      const result = await request.get(
        `/api/events?period=${period}&limit=50${region ? `&region=${encodeURIComponent(region)}` : ""}`,
      );
      expect(result.ok()).toBe(true);
      const data: EventResponse = await result.json();
      expect(data.mode).toBe("production");
      expect(data.range).toEqual(range(period));
      expect(data.total).toBe(expected(period, region).length);
      expect(data.events.map((e) => e.id)).toEqual(
        expected(period, region)
          .slice(0, 50)
          .map((e) => e.id),
      );
      for (const event of data.events) {
        expect(event.is_sample).toBe(0);
        expect(event.cost).toBe("unknown");
        expect(event.tags).toEqual([]);
      }
    }
  }
});
test("오늘·이번 주말·다음 주말 화면 필터", async ({ page }) => {
  for (const [period, label] of [
    ["today", "오늘 지금 떠나볼까?"],
    ["weekend", "이번 주말 기다려온 쉬는 날"],
    ["next-weekend", "다음 주말 미리 계획해요"],
  ] as const) {
    const response = page.waitForResponse(
      (r) =>
        r.url().includes("/api/events?") &&
        new URL(r.url()).searchParams.get("period") === period,
    );
    // Each click changes the period from the previous state (initial is weekend).
    await page.getByRole("button", { name: label, exact: true }).click();
    await response;
    await expect(page.locator(".event-card")).toHaveCount(
      Math.min(9, expected(period).length),
    );
    const titles = await page.locator(".event-card h3").allTextContents();
    expect(titles).toEqual(
      expected(period)
        .slice(0, 9)
        .map((e) => e.title),
    );
  }
});
test("전체 지역 화면 필터와 빈 결과", async ({ page }) => {
  for (const region of REGIONS) {
    const response = page.waitForResponse(
      (r) =>
        r.url().includes("/api/events?") &&
        new URL(r.url()).searchParams.get("region") === region,
    );
    await page.getByLabel("지역", { exact: true }).selectOption(region);
    await response;
    await expect(page.locator(".event-card")).toHaveCount(
      Math.min(9, expected("weekend", region).length),
    );
    expect(await page.locator(".event-card h3").allTextContents()).toEqual(
      expected("weekend", region)
        .slice(0, 9)
        .map((e) => e.title),
    );
  }
});
test("미확인 요금·동행·주제는 임의로 필터에 포함하지 않음", async ({
  request,
  page,
}) => {
  for (const [name, values] of [
    ["cost", ["free", "paid"]],
    ["audience", Object.keys(AUDIENCES)],
    ["theme", Object.keys(THEMES)],
  ] as const) {
    for (const value of values) {
      const result = await request.get(
        `/api/events?period=weekend&${name}=${value}`,
      );
      expect(result.ok()).toBe(true);
      expect((await result.json()).total).toBe(0);
    }
  }
  for (const cost of ["free", "paid"]) {
    const response = page.waitForResponse(
      (r) =>
        r.url().includes("/api/events?") &&
        new URL(r.url()).searchParams.get("cost") === cost,
    );
    await page.getByLabel("비용", { exact: true }).selectOption(cost);
    await response;
    await expect(
      page.getByRole("heading", { name: "조건에 맞는 행사가 아직 없어요" }),
    ).toBeVisible();
  }
});
test("실제 행사 상세의 일정·주소·출처·미확인 상태", async ({
  page,
  request,
}) => {
  const candidate = (["weekend", "today", "next-weekend"] as const).find(
    (p) => expected(p).length,
  );
  expect(
    candidate,
    "3개 기간 중 최소 하나에 실제 행사가 있어야 합니다.",
  ).toBeTruthy();
  const event = expected(candidate!)[0];
  const result = await request.get(`/api/events/${event.id}`);
  expect(result.ok()).toBe(true);
  const detail = await result.json();
  for (const field of [
    "title",
    "region",
    "address",
    "venue",
    "start_date",
    "end_date",
    "lat",
    "lng",
    "status",
  ] as const)
    expect(detail.event[field]).toEqual(event[field]);
  expect(
    detail.evidence.some((e: { field: string }) => e.field === "schedule"),
  ).toBe(true);
  if (candidate !== "weekend") {
    const response = page.waitForResponse(
      (r) =>
        r.url().includes("/api/events?") &&
        new URL(r.url()).searchParams.get("period") === candidate,
    );
    await page
      .getByRole("button", {
        name:
          candidate === "today"
            ? "오늘 지금 떠나볼까?"
            : "다음 주말 미리 계획해요",
        exact: true,
      })
      .click();
    await response;
  }
  await page
    .getByRole("button", { name: `${event.title} 상세 보기`, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: event.title, exact: true }),
  ).toBeVisible();
  await expect(dialog).toContainText(event.address);
  if (event.status === "unknown")
    await expect(dialog).toContainText("개최·취소 여부 미확인");
  await expect(dialog).toContainText("한국관광공사 TourAPI");
  await expect(
    dialog.getByRole("link", { name: "공식 출처 확인" }),
  ).toHaveAttribute("href", "https://www.data.go.kr/data/15101578/openapi.do");
});
test("실제 데이터 데스크톱·모바일 레이아웃과 JS 오류", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.reload();
  await expect(
    page.getByText("출발 전 개최 여부 확인", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(await page.getByText("샘플 미리보기", { exact: true }).count()).toBe(
    0,
  );
  await page.screenshot({
    path: `${test.info().project.outputDir}/tourapi-${test.info().project.name}.png`,
    fullPage: true,
  });
  const first = expected("weekend")[0];
  if (first?.checked_at) {
    const checked = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(first.checked_at));
    const label = `${Number(checked.slice(5, 7))}.${Number(checked.slice(8, 10))}`;
    await expect(
      page.locator(".event-card .card-bottom").first(),
    ).toContainText(label);
  }
  expect(errors).toEqual([]);
});
