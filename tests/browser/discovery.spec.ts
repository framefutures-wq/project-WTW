import { test, expect, type Page } from "@playwright/test";

for (const returnMethod of ["button", "history"] as const) {
  test(`상세에서 ${returnMethod} 복귀 시 열었던 카드로 포커스가 돌아간다`, async ({
    page,
  }) => {
    await page.goto("/");
    const card = page.locator(".event-card").first().getByRole("link");
    await expect(card).toBeVisible();
    await card.click();
    const detail = page.getByRole("region", { name: "행사 상세 정보" });
    await expect(detail).toBeVisible();
    if (returnMethod === "history") {
      await page.goBack();
    } else {
      await detail
        .getByRole("button", { name: "목록으로", exact: true })
        .click();
    }
    await expect(detail).not.toBeVisible();
    await expect(card).toBeFocused();
  });
}

// Synthetic media only: exercise the documented image-first composition without
// changing sample DB rows or relying on external image downloads.
async function withFeaturedImages(page: Page) {
  await page.route("https://tong.visitkorea.or.kr/ui-fixture-*.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><text x="30" y="60">SYNTHETIC TEST IMAGE</text></svg>',
    }),
  );
  await page.route("**/api/events?*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.events = body.events.map(
      (event: Record<string, unknown>, index: number) => ({
        ...event,
        image_url:
          index < 3
            ? `https://tong.visitkorea.or.kr/ui-fixture-${index}.svg`
            : null,
      }),
    );
    await route.fulfill({ response, json: body });
  });
}

async function scrollToLoadedResults(page: Page) {
  await expect(page.locator(".event-card").first()).toBeVisible();
  await page
    .locator(".results")
    .evaluate((element) =>
      element.scrollIntoView({ block: "start", behavior: "instant" }),
    );
}
test("샘플 안내·복합 필터·상세·빈 목록·한국 날짜 선택", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText("샘플 미리보기", { exact: true })).toBeVisible();
  await expect(page.locator(".event-card").first()).toBeVisible();
  await expect(page.locator(".featured-events")).toHaveCount(0);
  await expect(page.locator(".card-info-graphic").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "이번 주말, 어디 갈까?" }),
  ).toBeVisible();
  const regionResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/events" &&
      url.searchParams.get("region") === "서울"
    );
  });
  await page.getByLabel("지역", { exact: true }).selectOption("서울");
  await regionResponse;
  const flowerResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/events" &&
      url.searchParams.get("region") === "서울" &&
      url.searchParams.get("theme") === "flowers"
    );
  });
  await page
    .locator(".quick-category-grid")
    .getByRole("button", { name: "꽃", exact: true })
    .click();
  await expect(page.locator(".advanced-filters")).not.toHaveAttribute(
    "open",
    "",
  );
  await expect(page.locator(".active-filters")).toHaveCount(1);
  const flowerData = await (await flowerResponse).json();
  expect(flowerData.total).toBe(1);
  await expect(page.locator(".event-card")).toHaveCount(1);
  const flowerCardLink = page.getByRole("link", {
    name: "가을빛 꽃 산책 상세 보기",
  });
  await expect(flowerCardLink).toHaveAttribute("href", /^\/events\//);
  await flowerCardLink.click();
  const detailPage = page.getByRole("region", { name: "행사 상세 정보" });
  await expect(detailPage).toBeVisible();
  await expect(
    detailPage.getByText("실제 행사가 아닙니다.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "목록으로", exact: true }).click();
  await expect(detailPage).not.toBeVisible();
  await page
    .getByLabel("행사 이름 또는 장소 검색", { exact: true })
    .fill("없는 행사 이름");
  await expect(
    page.getByRole("heading", { name: "조건에 맞는 행사가 아직 없어요" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "필터 초기화", exact: true })
    .last()
    .click();
  await page.locator(".period").filter({ hasText: "다음 주말" }).click();
  await expect(
    page.getByRole("heading", { name: "다음 주말에 열리는 행사" }),
  ).toBeVisible();
  await expect(page.locator(".event-card")).toHaveCount(3);
  await page.locator(".period").filter({ hasText: "오늘" }).click();
  await expect(
    page.getByRole("heading", { name: "오늘 열리는 행사" }),
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
test("필터 초기화는 추천순 기본 탐색으로 돌아간다", async ({ page }) => {
  await page.goto("/?sort=date&region=서울");
  await expect(page.getByLabel("정렬", { exact: true })).toHaveValue("date");
  await expect(page.getByLabel("지역", { exact: true })).toHaveValue("서울");
  await expect(page).toHaveURL(/sort=date/);

  await page
    .getByRole("button", { name: "필터 초기화", exact: true })
    .last()
    .click();

  await expect(page.getByLabel("정렬", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("지역", { exact: true })).toHaveValue("");
  await expect(page).not.toHaveURL(/[?&](sort|region)=/);
  await expect(
    page.getByRole("heading", { name: "이번 주말, 어디 갈까?" }),
  ).toBeVisible();
});

test("아이와·데이트는 홈에서 한 번에 선택하고 주제와 조합할 수 있다", async ({
  page,
}) => {
  await page.goto("/");
  const advanced = page.locator(".advanced-filters");
  await expect(advanced).not.toHaveAttribute("open", "");

  const kidsResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/events" &&
      url.searchParams.get("audience") === "kids"
    );
  });
  await page
    .locator(".quick-category-grid")
    .getByRole("button", { name: "아이와", exact: true })
    .click();
  await kidsResponse;
  await expect(advanced).not.toHaveAttribute("open", "");
  await expect(
    page
      .locator(".quick-category-grid")
      .getByRole("button", { name: "아이와", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  const combinedResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/events" &&
      url.searchParams.get("audience") === "kids" &&
      url.searchParams.get("theme") === "performance"
    );
  });
  await page
    .locator(".quick-category-grid")
    .getByRole("button", { name: "공연", exact: true })
    .click();
  await combinedResponse;

  await expect(
    page
      .locator(".quick-category-grid")
      .getByRole("button", { name: "공연", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page
      .locator(".quick-category-grid")
      .getByRole("button", { name: "아이와", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await page
    .locator(".quick-category-grid")
    .getByRole("button", { name: "전체", exact: true })
    .click();
  await expect(
    page
      .locator(".quick-category-grid")
      .getByRole("button", { name: "전체", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("빠른 카테고리는 세부필터를 자동으로 열거나 같은 주제를 중복 표시하지 않는다", async ({
  page,
}) => {
  await page.goto("/");
  const advanced = page.locator(".advanced-filters");
  await expect(advanced).not.toHaveAttribute("open", "");

  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/events" &&
      url.searchParams.get("theme") === "performance"
    );
  });

  await page
    .locator(".quick-category-grid")
    .getByRole("button", { name: "공연", exact: true })
    .click();
  await responsePromise;

  await expect(advanced).not.toHaveAttribute("open", "");
  await expect(advanced.getByText("무엇을", { exact: true })).toHaveCount(0);
  await expect(page.locator(".active-filters")).toHaveCount(0);
  await expect(
    page
      .locator(".quick-category-grid")
      .getByRole("button", { name: "공연", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("서울 이번 주말 SEO landing은 같은 필터 결과를 바로 보여준다", async ({
  page,
}) => {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/events" &&
      url.searchParams.get("period") === "weekend" &&
      url.searchParams.get("region") === "서울"
    );
  });
  await page.goto("/weekend/seoul");
  await responsePromise;
  await expect(page).toHaveURL(/\/weekend\/seoul$/);
  await expect(page.getByLabel("지역", { exact: true })).toHaveValue("서울");
  await expect(page.locator(".active-filter")).toContainText(["서울"]);
  await expect(page.locator(".event-card").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const cardsFitViewport = await page
    .locator(".event-card")
    .evaluateAll((cards) =>
      cards.every((card) => {
        const rect = card.getBoundingClientRect();
        return rect.left >= -1 && rect.right <= innerWidth + 1;
      }),
    );
  expect(cardsFitViewport).toBe(true);
  await expect(
    page.getByRole("link", { name: "서울 이번 주말 행사" }),
  ).toHaveAttribute("href", "/weekend/seoul");
});

test("현재 위치를 사용한 거리순과 위치 해제", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 37.5665, longitude: 126.978 });
  await page.goto("/");
  await page.getByRole("button", { name: "내 주변 찾기" }).click();
  await expect(page.getByLabel("정렬: 가까운순")).toBeVisible();
  await expect(page.locator(".event-card").first()).toContainText("1km 미만");
  const locationButton = page.getByRole("button", { name: "내 주변 해제" });
  const filterBody = page.locator(".advanced-filter-body");
  await expect(filterBody).toBeVisible();
  const buttonBox = await locationButton.boundingBox();
  const filterBox = await filterBody.boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(filterBox).not.toBeNull();
  expect(filterBox!.y).toBeGreaterThanOrEqual(buttonBox!.y + buttonBox!.height);
  await page.getByRole("button", { name: "내 주변 해제" }).click();
  await expect(
    page.getByRole("button", { name: "내 주변 찾기" }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(page).not.toHaveURL(/[?&]sort=/);
  await expect(page.locator(".distance")).toHaveCount(0);
});

test("초기 화면은 결정 bar 뒤에 추천 행사가 바로 이어진다", async ({
  page,
}) => {
  for (const viewport of [
    { width: 1365, height: 768, maxSceneY: 720 },
    { width: 1920, height: 900, maxSceneY: 760 },
  ]) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto("/");
    await expect(page.locator(".header")).not.toHaveClass(/header-compact/);
    const hero = await page.locator(".hero").boundingBox();
    const decision = await page.locator(".decision-bar").boundingBox();
    const quick = await page.locator(".quick-discovery").boundingBox();
    const firstScene = await page
      .locator(".event-card .scene")
      .first()
      .boundingBox();
    const sampleBanner = await page.locator(".sample-banner").boundingBox();
    expect(hero).not.toBeNull();
    expect(decision).not.toBeNull();
    expect(quick).not.toBeNull();
    expect(firstScene).not.toBeNull();
    expect(hero!.height).toBeLessThanOrEqual(190);
    expect(decision!.y).toBeGreaterThanOrEqual(hero!.y + hero!.height);
    expect(quick!.y).toBeGreaterThan(firstScene!.y);
    const productionAdjustedY = firstScene!.y - (sampleBanner?.height ?? 0);
    expect(productionAdjustedY).toBeLessThanOrEqual(viewport.maxSceneY + 70);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("데스크톱 홈 상단과 하단은 같은 가로 레일에 맞는다", async ({ page }) => {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 1365, height: 900 },
    { width: 1920, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator(".event-card").first()).toBeVisible();

    const hero = await page.locator(".hero").boundingBox();
    const principle = await page.locator(".principle").boundingBox();
    const footer = await page.locator("footer").boundingBox();

    expect(hero).not.toBeNull();
    expect(principle).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(Math.abs(hero!.x - principle!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(hero!.width - principle!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(hero!.x - footer!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(hero!.width - footer!.width)).toBeLessThanOrEqual(1);
  }
});

test("추천 영역과 전체 목록은 박스 중첩 없이 시각적으로 분리되고 카드 정보 위계가 유지된다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1365, height: 900 });
  await withFeaturedImages(page);
  await page.goto("/");
  await expect(page.locator(".featured-events")).toBeVisible();
  await expect(page.locator(".all-events-section")).toBeVisible();
  await expect
    .poll(() =>
      page.locator(".featured-events .scene-image-foreground").first().evaluate(
        (image: HTMLImageElement) => image.naturalWidth,
      ),
    )
    .toBeGreaterThan(0);

  const featuredStyle = await page
    .locator(".featured-events")
    .evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        paddingTop: parseFloat(style.paddingTop),
        borderTopWidth: parseFloat(style.borderTopWidth),
        borderRadius: parseFloat(style.borderRadius),
        backgroundColor: style.backgroundColor,
      };
    });
  expect(featuredStyle.paddingTop).toBe(0);
  expect(featuredStyle.borderTopWidth).toBe(0);
  expect(featuredStyle.borderRadius).toBe(0);
  expect(featuredStyle.backgroundColor).toBe("rgba(0, 0, 0, 0)");

  const featuredBox = await page.locator(".featured-events").boundingBox();
  const decisionBox = await page.locator(".decision-bar").boundingBox();
  const allBox = await page.locator(".all-events-section").boundingBox();
  expect(featuredBox).not.toBeNull();
  expect(decisionBox).not.toBeNull();
  expect(allBox).not.toBeNull();
  expect(featuredBox!.y + featuredBox!.height).toBeLessThanOrEqual(
    decisionBox!.y,
  );
  expect(decisionBox!.y + decisionBox!.height).toBeLessThanOrEqual(allBox!.y);
  const divider = await page
    .locator(".decision-bar")
    .evaluate((el) => parseFloat(getComputedStyle(el).borderBottomWidth));
  expect(divider).toBeGreaterThanOrEqual(1);

  const titleStyle = await page
    .locator(".featured-events .card-content h3")
    .first()
    .evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        fontSize: parseFloat(style.fontSize),
        fontWeight: parseInt(style.fontWeight, 10),
      };
    });
  expect(titleStyle.fontSize).toBeGreaterThanOrEqual(15);
  expect(titleStyle.fontWeight).toBeGreaterThanOrEqual(700);

  const dateWeight = await page
    .locator(".featured-events .event-date")
    .first()
    .evaluate((el) => parseInt(getComputedStyle(el).fontWeight, 10));
  expect(dateWeight).toBeGreaterThanOrEqual(500);

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("홈 벤치마크는 추천을 주인공으로 두고 카드 메타를 한 줄로 유지한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1365, height: 900 });
  await withFeaturedImages(page);
  await page.goto("/");
  await expect(page.locator(".featured-events")).toBeVisible();

  const featured = await page.locator(".featured-events").evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      paddingTop: parseFloat(style.paddingTop),
      borderTopWidth: parseFloat(style.borderTopWidth),
      borderRadius: parseFloat(style.borderRadius),
      backgroundColor: style.backgroundColor,
    };
  });
  expect(featured.paddingTop).toBe(0);
  expect(featured.borderTopWidth).toBe(0);
  expect(featured.borderRadius).toBe(0);
  expect(featured.backgroundColor).toBe("rgba(0, 0, 0, 0)");

  await expect(page.getByText("이번 주말 추천", { exact: true })).toBeVisible();
  await expect(page.getByText("먼저 볼 곳", { exact: true })).toHaveCount(0);

  const firstCard = page.locator(".event-card").first();
  await expect(firstCard.locator(".venue")).toHaveCount(0);
  const meta = firstCard.locator(".card-meta");
  await expect(meta).toBeVisible();

  const accent = await page
    .locator(".hero-search-submit")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(accent).toBe("rgb(244, 90, 42)");

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("홈 카테고리와 날짜 컨트롤은 보조 설명 없이 짧은 라벨만 유지한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto("/");

  await expect(page.getByText("빠르게 둘러보기", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("관심 있는 주제를 누르면 바로 골라드려요.", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("모든 행사", { exact: true })).toHaveCount(0);
  await expect(page.getByText("시장 · 푸드", { exact: true })).toHaveCount(0);
  await expect(page.getByText("지금 떠나볼까?", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("기다려온 쉬는 날", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("원하는 날을 골라요", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("누구와 · 알림", { exact: true })).toHaveCount(0);

  const quickHeight = await page
    .locator(".quick-category")
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).height));
  expect(quickHeight).toBeLessThanOrEqual(50);

  const periodHeight = await page
    .locator(".period")
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).height));
  expect(periodHeight).toBeLessThanOrEqual(44);

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("스크롤 후 상단 검색이 고정 탐색으로 전환된다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("상단 행사 이름 또는 장소 검색")).toHaveCount(0);
  await scrollToLoadedResults(page);
  await expect(page.locator(".header")).toHaveClass(/header-compact/);
  await expect(page.getByLabel("상단 행사 이름 또는 장소 검색")).toBeVisible();
  const mobile = (page.viewportSize()?.width ?? 0) <= 760;
  if (mobile) {
    await expect(page.locator(".region-quick-trigger")).not.toBeVisible();
    await expect(page.locator(".category-quick-trigger")).not.toBeVisible();
  } else {
    await expect(page.locator(".region-quick-trigger")).toBeVisible();
    await expect(page.locator(".category-quick-trigger")).toBeVisible();
  }
});

test("데스크톱 스크롤 상단 탐색은 검색과 지역·카테고리가 겹치지 않는다", async ({
  page,
}) => {
  test.skip(
    (page.viewportSize()?.width ?? 0) <= 760,
    "모바일은 지역·카테고리 퀵 스위치를 숨깁니다.",
  );
  await page.goto("/");
  await scrollToLoadedResults(page);
  await expect(page.locator(".header")).toHaveClass(/header-compact/);
  await expect(page.locator(".region-quick-trigger")).toHaveCount(1);
  await expect(page.locator(".category-quick-trigger")).toHaveCount(1);
  const search = await page.locator(".compact-search").boundingBox();
  const region = await page.locator(".region-quick-trigger").boundingBox();
  expect(search).not.toBeNull();
  expect(region).not.toBeNull();
  expect(search!.x + search!.width + 12).toBeLessThanOrEqual(region!.x);
});

test("상세는 핵심 일정·장소를 소개보다 먼저 보여준다", async ({ page }) => {
  await page.goto("/");
  await page.locator(".event-card").first().getByRole("link").click();
  const detailPage = page.locator(".event-detail-page");
  await expect(detailPage.locator(".detail-primary-facts")).toBeVisible();
  await expect(
    detailPage.locator(".detail-primary-fact").first(),
  ).toContainText("일정");
  const facts = await detailPage.locator(".detail-primary-facts").boundingBox();
  const description = await detailPage
    .locator(".detail-description")
    .first()
    .boundingBox();
  if (description) {
    expect(facts).not.toBeNull();
    expect(facts!.y).toBeLessThan(description.y);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("모바일 홈부터 상세까지 탐색 흐름이 끊기지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  const mobilePrinciple = await page.locator(".principle").boundingBox();
  const mobileFooter = await page.locator("footer").boundingBox();
  expect(mobilePrinciple).not.toBeNull();
  expect(mobileFooter).not.toBeNull();
  expect(Math.abs(mobilePrinciple!.x - mobileFooter!.x)).toBeLessThanOrEqual(1);
  expect(
    Math.abs(mobilePrinciple!.width - mobileFooter!.width),
  ).toBeLessThanOrEqual(1);

  await scrollToLoadedResults(page);
  await expect(page.locator(".header")).toHaveClass(/header-compact/);
  await expect(page.getByLabel("상단 행사 이름 또는 장소 검색")).toBeVisible();
  await expect(page.locator(".region-quick-trigger")).not.toBeVisible();
  await expect(page.locator(".category-quick-trigger")).not.toBeVisible();

  const firstCardButton = page.locator(".event-card").first().getByRole("link");
  await firstCardButton.click();

  const detailPage = page.locator(".event-detail-page");
  await expect(detailPage).toBeVisible();
  await expect(detailPage.locator(".detail-primary-facts")).toBeVisible();
  await expect(
    detailPage.getByRole("button", { name: "목록으로", exact: true }),
  ).toBeVisible();

  const box = await detailPage.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.width).toBeLessThanOrEqual(390);

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  const facts = await detailPage.locator(".detail-primary-facts").boundingBox();
  const description = await detailPage
    .locator(".detail-description")
    .first()
    .boundingBox();
  if (description) {
    expect(facts).not.toBeNull();
    expect(facts!.y).toBeLessThan(description.y);
  }

  await detailPage.locator(".detail-source-row").scrollIntoViewIfNeeded();
  await expect(detailPage.locator(".detail-source-row")).toBeVisible();
  await detailPage
    .getByRole("button", { name: "목록으로", exact: true })
    .click();
  await expect(detailPage).not.toBeVisible();
  await expect(firstCardButton).toBeFocused();
});

test("모바일 추천은 큰 카드의 수평 레일 안에서 탐색된다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await withFeaturedImages(page);
  await page.goto("/");
  await expect(page.locator(".featured-events")).toBeVisible();

  const rail = page.locator(".featured-composition");
  const dimensions = await rail.evaluate((el) => ({
    width: el.clientWidth,
    scrollWidth: el.scrollWidth,
    firstCardWidth: el.firstElementChild!.getBoundingClientRect().width,
  }));
  expect(dimensions.firstCardWidth).toBeGreaterThanOrEqual(
    dimensions.width * 0.9,
  );
  expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.width);
  await rail.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await expect
    .poll(() => rail.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);

  const titleSize = await page
    .locator(".featured-events .card-content h3")
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(titleSize).toBeGreaterThanOrEqual(18);
  expect(titleSize).toBeLessThanOrEqual(20);

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("소수 결과의 탐색 전환은 큰 박스 대신 가벼운 구분선으로 이어진다", async ({
  page,
}) => {
  await page.goto("/");
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/events" &&
      url.searchParams.get("theme") === "performance"
    );
  });
  await page
    .locator(".quick-category-grid")
    .getByRole("button", { name: "공연", exact: true })
    .click();
  await responsePromise;
  await expect(page.locator(".exploration-cta")).toBeVisible();

  const style = await page.locator(".exploration-cta").evaluate((el) => {
    const css = getComputedStyle(el);
    return {
      borderTop: parseFloat(css.borderTopWidth),
      borderLeft: parseFloat(css.borderLeftWidth),
      radius: parseFloat(css.borderRadius),
      background: css.backgroundColor,
    };
  });
  expect(style.borderTop).toBeGreaterThanOrEqual(1);
  expect(style.borderLeft).toBe(0);
  expect(style.radius).toBe(0);
  expect(style.background).toBe("rgba(0, 0, 0, 0)");
});

test("하단 신뢰영역과 footer는 밝은 브랜드 마감으로 이어지고 준비중 문구가 없다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto("/");
  await expect(page.locator(".principle")).toBeVisible();
  await expect(page.locator("footer")).toBeVisible();
  await expect(page.getByText("운영 준비 중", { exact: false })).toHaveCount(0);

  const styles = await page.evaluate(() => {
    const principle = document.querySelector(".principle");
    const footer = document.querySelector("footer");
    const brand = document.querySelector(".footer-brand");
    if (!principle || !footer || !brand) return null;
    const ps = getComputedStyle(principle);
    const fs = getComputedStyle(footer);
    const bs = getComputedStyle(brand);
    return {
      principleBg: ps.backgroundColor,
      principleRadius: parseFloat(ps.borderRadius),
      footerBg: fs.backgroundColor,
      footerRadius: parseFloat(fs.borderTopLeftRadius),
      footerColor: fs.color,
      brandWeight: parseInt(bs.fontWeight, 10),
    };
  });

  expect(styles).not.toBeNull();
  expect(styles!.principleRadius).toBeGreaterThanOrEqual(20);
  expect(styles!.footerRadius).toBeGreaterThanOrEqual(20);
  expect(styles!.footerBg).not.toBe("rgb(17, 24, 32)");
  expect(styles!.brandWeight).toBeGreaterThanOrEqual(800);
  const footerBox = await page.locator("footer").boundingBox();
  expect(footerBox).not.toBeNull();
  const footerFinish = await page.locator("footer").evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      bottomRadius: parseFloat(style.borderBottomLeftRadius),
      bottomBorder: parseFloat(style.borderBottomWidth),
      marginBottom: parseFloat(style.marginBottom),
    };
  });
  expect(footerFinish.bottomRadius).toBeGreaterThanOrEqual(20);
  expect(footerFinish.bottomBorder).toBeGreaterThanOrEqual(1);
  expect(footerFinish.marginBottom).toBeGreaterThanOrEqual(30);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("900px 상세는 미디어·결정 요약·출처가 겹치지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto("/");
  await page.locator(".event-card").first().getByRole("link").click();
  const detailPage = page.locator(".event-detail-page");
  await expect(detailPage).toBeVisible();

  const media = await detailPage.locator(".scene-detail").boundingBox();
  const summary = await detailPage
    .locator(".detail-summary-panel")
    .boundingBox();
  expect(media).not.toBeNull();
  expect(summary).not.toBeNull();
  expect(media!.x + media!.width).toBeLessThanOrEqual(summary!.x);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  const sourceRow = detailPage.locator(".detail-source-row");
  await sourceRow.scrollIntoViewIfNeeded();
  const direction = await sourceRow.evaluate(
    (el) => getComputedStyle(el).flexDirection,
  );
  expect(direction).toBe("column");

  const source = await sourceRow.locator(".detail-source").boundingBox();
  const back = await sourceRow
    .getByRole("button", { name: "목록으로 돌아가기" })
    .boundingBox();
  expect(source).not.toBeNull();
  expect(back).not.toBeNull();
  expect(source!.width).toBeGreaterThan(240);
  expect(back!.width).toBeGreaterThan(240);
});

test("470px 상세는 결정 요약 다음 미디어를 보여주고 가로로 넘치지 않는다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 470, height: 760 });
  await page.goto("/");
  await page.locator(".event-card").first().getByRole("link").click();
  const detailPage = page.locator(".event-detail-page");
  await expect(detailPage).toBeVisible();

  const summary = await detailPage
    .locator(".detail-summary-panel")
    .boundingBox();
  const media = await detailPage.locator(".scene-detail").boundingBox();
  expect(summary).not.toBeNull();
  expect(media).not.toBeNull();
  expect(summary!.y + summary!.height).toBeLessThanOrEqual(media!.y);

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  await detailPage.locator(".detail-source-row").scrollIntoViewIfNeeded();
  const back = await detailPage
    .getByRole("button", { name: "목록으로 돌아가기" })
    .boundingBox();
  const detailPageBox = await detailPage.boundingBox();
  expect(back).not.toBeNull();
  expect(detailPageBox).not.toBeNull();
  expect(back!.width).toBeGreaterThan(90);
});

test("데스크톱 상세 미디어와 결정 요약은 첫 화면에 나란히 표시된다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.locator(".event-card").first().getByRole("link").click();
  const detailPage = page.locator(".event-detail-page");
  const scene = detailPage.locator(".scene-detail");
  await expect(scene).toBeVisible();
  const box = await scene.boundingBox();
  expect(box).not.toBeNull();
  const summary = await detailPage
    .locator(".detail-summary-panel")
    .boundingBox();
  expect(summary).not.toBeNull();
  expect(box!.height).toBeGreaterThan(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(summary!.x);
  expect(box!.y + box!.height).toBeLessThanOrEqual(900);
  expect(summary!.y).toBeLessThan(box!.y + box!.height);
  expect(summary!.y + summary!.height).toBeGreaterThan(box!.y);
});

test("모바일 상세 미디어는 결정 요약 뒤에서 높이가 제한된다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 470, height: 760 });
  await page.goto("/");
  await page.locator(".event-card").first().getByRole("link").click();
  const detailPage = page.locator(".event-detail-page");
  const scene = detailPage.locator(".scene-detail");
  const box = await scene.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(180);
  expect(box!.height).toBeLessThanOrEqual(300);
  const summary = await detailPage
    .locator(".detail-summary-panel")
    .boundingBox();
  expect(summary).not.toBeNull();
  expect(summary!.y + summary!.height).toBeLessThanOrEqual(box!.y);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(470);
});
