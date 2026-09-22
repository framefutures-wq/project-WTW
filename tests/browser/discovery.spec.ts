import { test, expect } from "@playwright/test";
test("샘플 안내·복합 필터·상세·빈 목록·한국 날짜 선택", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText("샘플 미리보기", { exact: true })).toBeVisible();
  await expect(page.locator(".event-card").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "이번 주말의 발견" }),
  ).toBeVisible();
  await page.getByLabel("지역", { exact: true }).selectOption("서울");
  await page.locator(".advanced-filters > summary").click();
  await page.getByRole("button", { name: "꽃", exact: true }).click();
  await expect(page.locator(".event-card")).toHaveCount(1);
  await page.getByRole("button", { name: "가을빛 꽃 산책 상세 보기" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page
      .getByRole("dialog")
      .getByText("실제 행사가 아닙니다.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByLabel("행사 이름 또는 장소 검색").fill("없는 행사 이름");
  await expect(
    page.getByRole("heading", { name: "조건에 맞는 행사가 아직 없어요" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "필터 초기화", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "다음 주말", exact: false }).click();
  await expect(
    page.getByRole("heading", { name: "다음 주말의 발견" }),
  ).toBeVisible();
  await expect(page.locator(".event-card")).toHaveCount(3);
  await page.getByRole("button", { name: "오늘 지금 떠나볼까?" }).click();
  await expect(
    page.getByRole("heading", { name: "오늘의 발견" }),
  ).toBeVisible();
  await expect(page.locator(".event-card").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `${test.info().project.outputDir}/discovery-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("현재 위치를 사용한 거리순과 위치 해제", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 37.5665, longitude: 126.978 });
  await page.goto("/");
  await page.getByRole("button", { name: "내 주변 찾기" }).click();
  await expect(page.getByLabel("정렬: 가까운순")).toBeVisible();
  await expect(page.locator(".event-card").first()).toContainText("1km 미만");
  await page.getByRole("button", { name: "내 주변 해제" }).click();
  await expect(page.getByLabel("정렬", { exact: true })).toHaveValue("recommended");
  await expect(page.locator(".distance")).toHaveCount(0);
});

test("스크롤 후 상단 검색이 고정 탐색으로 전환된다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("상단 행사 이름 또는 장소 검색")).toHaveCount(0);
  await page.locator(".results").scrollIntoViewIfNeeded();
  await expect(page.locator(".header")).toHaveClass(/header-compact/);
  await expect(page.getByLabel("상단 행사 이름 또는 장소 검색")).toBeVisible();
  await expect(page.locator(".region-quick-trigger")).toBeVisible();
  await expect(page.locator(".category-quick-trigger")).toBeVisible();
});

test("스크롤 상단 탐색은 검색과 지역·카테고리가 겹치지 않는다", async ({ page }) => {
  await page.goto("/");
  await page.locator(".results").scrollIntoViewIfNeeded();
  await expect(page.locator(".header")).toHaveClass(/header-compact/);
  await expect(page.locator(".region-quick-trigger")).toHaveCount(1);
  await expect(page.locator(".category-quick-trigger")).toHaveCount(1);
  const search = await page.locator(".compact-search").boundingBox();
  const region = await page.locator(".region-quick-trigger").boundingBox();
  expect(search).not.toBeNull();
  expect(region).not.toBeNull();
  expect(search!.x + search!.width + 12).toBeLessThanOrEqual(region!.x);
});
