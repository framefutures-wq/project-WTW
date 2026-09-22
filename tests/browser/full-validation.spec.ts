import {
  test as base,
  expect,
  type Page,
  type Response,
} from "@playwright/test";
import { spawnSync } from "node:child_process";
import {
  REGIONS,
  AUDIENCES,
  THEMES,
  type EventItem,
  type EventResponse,
} from "../../shared/domain";
import { PAGE_SIZE } from "../../shared/list-exploration";

type Row = EventItem & { tag_list: string | null };
type ApiBody = Partial<EventResponse> & {
  database?: string;
  regions?: string[];
  audiences?: typeof AUDIENCES;
  themes?: typeof THEMES;
  event?: EventItem;
  error?: string;
};
type Filters = {
  period: "today" | "weekend" | "next-weekend";
  region?: string;
  cost?: string;
  audience?: string;
  theme?: string;
};
const test = base.extend<{}, { rows: Row[] }>({
  rows: [
    async ({}, use) => {
      const result = spawnSync(
        "npx",
        [
          "wrangler",
          "d1",
          "execute",
          "weekend-mwohae",
          "--local",
          "--config",
          "wrangler.jsonc",
          "--json",
          "--command",
          "SELECT e.*, (SELECT group_concat(tag) FROM event_tags WHERE event_id=e.id) AS tag_list FROM events e ORDER BY start_date,id",
        ],
        { encoding: "utf8", timeout: 30000 },
      );
      expect(result.status, result.stderr).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output[0].success).toBe(true);
      const rows: Row[] = output[0].results.map((r: Row) => ({
        ...r,
        tags: (r.tag_list ?? "").split(",").filter(Boolean),
      }));
      expect(rows.length).toBeGreaterThan(0);
      await use(rows);
    },
    { scope: "worker" },
  ],
});

// Deliberately independent of the application's dateRange implementation.
function range(period: Filters["period"]) {
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (period === "today") return { start: today, end: today };
  const date = new Date(today + "T00:00:00Z");
  const weekday = date.getUTCDay();
  date.setUTCDate(
    date.getUTCDate() +
      (weekday === 0 ? -1 : 6 - weekday) +
      (period === "next-weekend" ? 7 : 0),
  );
  const start = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 1);
  return { start, end: date.toISOString().slice(0, 10) };
}
function expected(rows: Row[], f: Filters) {
  const dates = range(f.period);
  return rows.filter(
    (e) =>
      e.is_sample === 1 &&
      e.verification === "sample" &&
      e.status === "scheduled" &&
      e.start_date <= dates.end &&
      e.end_date >= dates.start &&
      (!f.region || e.region === f.region) &&
      (!f.cost || e.cost === f.cost) &&
      (!f.audience ||
        e.tags.includes(f.audience as EventItem["tags"][number])) &&
      (f.audience !== "pets" || e.pet_policy === "allowed") &&
      (!f.theme || e.tags.includes(f.theme as EventItem["tags"][number])),
  );
}
async function assertResults(
  page: Page,
  rows: Row[],
  f: Filters,
  response?: Response,
) {
  let data: EventResponse;
  if (response) {
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(response.headers()["cache-control"]).toBe("no-store");
    data = await response.json();
  } else {
    data = await page.evaluate(
      async (filters) => {
        const params = new URLSearchParams(filters);
        return (await fetch("/api/events?" + params)).json();
      },
      Object.fromEntries(
        Object.entries(f).filter(([, value]) => Boolean(value)),
      ),
    );
  }
  const match = expected(rows, f);
  expect(data.mode).toBe("sample");
  expect(data.range).toEqual(range(f.period));
  expect(data.total).toBe(match.length);
  expect(data.events.map((e) => e.id)).toEqual(
    match.slice(0, data.limit).map((e) => e.id),
  );
  for (const event of data.events) {
    const row = match.find((r) => r.id === event.id)!;
    for (const key of [
      "title",
      "description",
      "region",
      "venue",
      "address",
      "start_date",
      "end_date",
      "cost",
      "price_text",
      "pet_policy",
      "status",
      "verification",
      "is_sample",
      "lat",
      "lng",
      "checked_at",
    ] as const)
      expect(event[key], key).toEqual(row[key]);
    expect([...event.tags].sort()).toEqual([...row.tags].sort());
  }
  await expect(page.locator(".results")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".event-card")).toHaveCount(
    Math.min(match.length, PAGE_SIZE),
  );
  await expect(page.locator(".event-card h3")).toHaveText(
    match.slice(0, PAGE_SIZE).map((e) => e.title),
  );
  await expect(page.locator(".result-heading h2 span")).toHaveText(
    String(match.length),
  );
  if (!match.length)
    await expect(
      page.getByRole("heading", { name: "조건에 맞는 행사가 아직 없어요" }),
    ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
async function change(
  page: Page,
  rows: Row[],
  filters: Filters,
  action: () => Promise<unknown>,
) {
  const response = page.waitForResponse((r) => {
    const url = new URL(r.url());
    return (
      url.pathname === "/api/events" &&
      Object.entries(filters).every(
        ([k, v]) => (url.searchParams.get(k) ?? "") === v,
      )
    );
  });
  await action();
  await assertResults(page, rows, filters, await response);
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".event-card").first()).toBeVisible();
});
test("데스크톱·모바일 화면, 모든 카드 상세, 오류와 레이아웃", async ({
  page,
  rows,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await assertResults(page, rows, { period: "weekend" });
  await expect(page.getByText("샘플 미리보기", { exact: true })).toBeVisible();
  const cards = page.locator(".event-card");
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    const title = await cards.nth(i).locator("h3").innerText();
    await cards.nth(i).getByRole("button").click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(cards.nth(i).getByRole("button")).toBeFocused();
  }
  await page
    .getByRole("button", { name: "정보 확인 원칙", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText("추측 대신, 확인된 정보"),
  ).toBeVisible();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.screenshot({
    path: `${info.project.outputDir}/full-${info.project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("오늘·이번 주말·다음 주말: D1과 날짜 및 목록 대조", async ({
  page,
  rows,
}) => {
  await assertResults(page, rows, { period: "weekend" });
  for (const [period, label] of [
    ["today", "오늘"],
    ["next-weekend", "다음 주말"],
    ["weekend", "이번 주말"],
  ] as const)
    await change(page, rows, { period }, () =>
      page.locator(".period").filter({ hasText: label }).click(),
    );
});
test("전국 및 17개 지역 전체: 일치 결과와 빈 결과", async ({ page, rows }) => {
  for (const region of [...REGIONS, ""])
    await change(page, rows, { period: "weekend", region }, () =>
      page.getByLabel("지역", { exact: true }).selectOption(region),
    );
});
test("아이·커플·부모님·반려동물 및 선택 해제", async ({ page, rows }) => {
  for (const [audience, label] of Object.entries(AUDIENCES)) {
    await change(page, rows, { period: "weekend", audience }, () =>
      page.getByRole("button", { name: label, exact: true }).click(),
    );
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await change(page, rows, { period: "weekend", audience: "" }, () =>
      page.getByRole("button", { name: label, exact: true }).click(),
    );
  }
});
test("먹거리·불꽃·꽃·체험·공연 및 선택 해제", async ({ page, rows }) => {
  for (const [theme, label] of Object.entries(THEMES)) {
    await change(page, rows, { period: "weekend", theme }, () =>
      page.getByRole("button", { name: label, exact: true }).click(),
    );
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await change(page, rows, { period: "weekend", theme: "" }, () =>
      page.getByRole("button", { name: label, exact: true }).click(),
    );
  }
});
test("지역·동행·카테고리 복합 필터와 초기화", async ({ page, rows }) => {
  await change(page, rows, { period: "weekend", region: "서울" }, () =>
    page.getByLabel("지역", { exact: true }).selectOption("서울"),
  );
  await change(
    page,
    rows,
    { period: "weekend", region: "서울", audience: "pets" },
    () => page.getByRole("button", { name: "반려동물과", exact: true }).click(),
  );
  await change(
    page,
    rows,
    {
      period: "weekend",
      region: "서울",
      audience: "pets",
      theme: "flowers",
    },
    () => page.getByRole("button", { name: "꽃", exact: true }).click(),
  );
  await change(
    page,
    rows,
    { period: "weekend", region: "", audience: "", theme: "" },
    () =>
      page
        .getByRole("button", { name: "필터 초기화", exact: true })
        .first()
        .click(),
  );
});
test("실제 브라우저 API: health·meta·상세·오류·페이지·D1", async ({
  page,
  rows,
}) => {
  const results = await page.evaluate(async () => {
    const paths = [
      "/api/health",
      "/api/meta",
      "/api/events?period=weekend&limit=1&page=1",
      "/api/events?period=weekend&limit=1&page=2",
      "/api/events/sample-01",
      "/api/events/not-found",
      "/api/unknown",
      "/api/events?region=invalid",
      "/api/events?sort=distance",
      "/api/events?limit=51",
      "/api/events?q=" + encodeURIComponent("' OR 1=1 --"),
    ];
    const results = [];
    for (const path of paths) {
      const r = await fetch(path);
      results.push({
        path,
        status: r.status,
        body: (await r.json()) as ApiBody,
      });
    }
    const post = await fetch("/api/events", { method: "POST" });
    results.push({
      path: "POST",
      status: post.status,
      body: (await post.json()) as ApiBody,
    });
    return results;
  });
  expect(results.map((r) => r.status)).toEqual([
    200, 200, 200, 200, 200, 404, 404, 400, 400, 400, 200, 405,
  ]);
  expect(results[0].body.database).toBe("connected");
  expect(results[1].body.regions).toEqual([...REGIONS]);
  expect(results[1].body.audiences).toEqual(AUDIENCES);
  expect(results[1].body.themes).toEqual(THEMES);
  const matches = expected(rows, { period: "weekend" });
  expect(results[2].body.events?.[0].id).toBe(matches[0].id);
  expect(results[3].body.events?.[0].id).toBe(matches[1].id);
  expect(results[4].body.event?.title).toBe(
    rows.find((r) => r.id === "sample-01")!.title,
  );
  expect(results[10].body.total).toBe(0);
  for (const r of results.filter((r) => r.status >= 400))
    expect(typeof r.body.error).toBe("string");
});
test("API 장애 안내·재시도 복구·상세 오류 안내", async ({ page, rows }) => {
  await page.route("**/api/events?**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "테스트용 일시 장애" }),
    }),
  );
  await page.getByLabel("지역", { exact: true }).selectOption("서울");
  await expect(
    page.getByRole("heading", { name: "잠시 연결이 어려워요" }),
  ).toBeVisible();
  await expect(
    page.locator(".empty").getByText("테스트용 일시 장애"),
  ).toBeVisible();
  await page.unroute("**/api/events?**");
  await change(page, rows, { period: "weekend", region: "서울" }, () =>
    page.getByRole("button", { name: "다시 시도", exact: true }).click(),
  );
  await page.route("**/api/events/sample-*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "테스트용 상세 장애" }),
    }),
  );
  await page.locator(".event-card").first().getByRole("button").click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "불러오지 못했어요" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("테스트용 상세 장애"),
  ).toBeVisible();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
});
test("늦은 응답이 최신 지역 필터를 덮어쓰지 않음", async ({ page, rows }) => {
  let started!: () => void;
  const captured = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/api/events?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("region") === "서울") {
      const response = await route.fetch();
      started();
      await new Promise((resolve) => setTimeout(resolve, 700));
      try {
        await route.fulfill({ response });
      } catch {
        /* Request was intentionally aborted by React. */
      }
    } else await route.continue();
  });
  await page.getByLabel("지역", { exact: true }).selectOption("서울");
  await captured;
  await change(page, rows, { period: "weekend", region: "부산" }, () =>
    page.getByLabel("지역", { exact: true }).selectOption("부산"),
  );
  // Let the obsolete response arrive before checking the final visible result.
  await page.waitForTimeout(900);
  await assertResults(page, rows, { period: "weekend", region: "부산" });
});
