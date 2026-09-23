import { test, expect } from "@playwright/test";

test("production discovery shell and public endpoints are healthy", async ({
  page,
  request,
}) => {
  const pageErrors: string[] = [];
  const failedFirstPartyRequests: string[] = [];
  const origin = new URL(test.info().project.use.baseURL as string).origin;

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (req) => {
    try {
      if (new URL(req.url()).origin === origin)
        failedFirstPartyRequests.push(`${req.method()} ${req.url()}`);
    } catch {}
  });

  const [health, robots, sitemap] = await Promise.all([
    request.get("/api/health"),
    request.get("/robots.txt"),
    request.get("/sitemap.xml"),
  ]);
  expect(health.ok()).toBe(true);
  expect((await health.json()).database).toBeTruthy();
  expect(robots.ok()).toBe(true);
  expect(await robots.text()).toContain(
    "Sitemap: https://galteum.com/sitemap.xml",
  );
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain("<urlset");

  const response = await page.goto("/");
  expect(response?.ok()).toBe(true);
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator(".results h2")).toBeVisible();

  await page.locator(".region-quick-trigger").click();
  await expect(page.getByRole("dialog", { name: "지역 선택" })).toBeVisible();
  await page.getByRole("button", { name: "지역 선택 닫기" }).click();

  await page.locator(".category-quick-trigger").click();
  await expect(
    page.getByRole("dialog", { name: "카테고리 선택" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "카테고리 선택 닫기" }).click();

  await expect(page.getByLabel("지역", { exact: true })).toBeVisible();
  await expect(page.getByLabel("정렬", { exact: true })).toBeVisible();

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  const periods = ["weekend", "today", "next-weekend"] as const;
  let eventId = "";
  for (const period of periods) {
    const events = await request.get(
      `/api/events?period=${period}&limit=1&sort=date`,
    );
    expect(events.ok()).toBe(true);
    const body = await events.json();
    if (body.events?.[0]?.id) {
      eventId = body.events[0].id;
      break;
    }
  }

  if (eventId) {
    const eventResponse = await request.get(
      `/api/events/${encodeURIComponent(eventId)}`,
    );
    expect(eventResponse.ok()).toBe(true);
    const eventTitle = (await eventResponse.json()).event.title;
    const detail = await page.goto(`/events/${encodeURIComponent(eventId)}`);
    expect(detail?.ok()).toBe(true);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("dialog").getByRole("heading", { name: eventTitle }),
    ).toBeVisible();

    const mediaPair = page.locator(".detail-dialog .detail-media-pair");
    const pairedMedia = mediaPair.locator("button");
    const hasMediaPair = (await mediaPair.count()) > 0;
    const scene = hasMediaPair
      ? pairedMedia.first()
      : page
          .locator(".detail-dialog .detail-media, .detail-dialog .scene-detail")
          .first();
    await expect(scene).toBeVisible();
    const sceneBox = await scene.boundingBox();
    expect(sceneBox).not.toBeNull();
    const viewportWidth = page.viewportSize()?.width ?? 0;
    if (viewportWidth >= 1000) {
      const mediaBox = hasMediaPair ? await mediaPair.boundingBox() : sceneBox;
      expect(mediaBox).not.toBeNull();
      const mediaRatio = mediaBox!.width / mediaBox!.height;
      expect(mediaBox!.height).toBeLessThanOrEqual(360);
      expect(mediaBox!.height).toBeGreaterThan(220);
      expect(mediaRatio).toBeGreaterThan(1.15);
      expect(mediaRatio).toBeLessThan(1.5);
    } else {
      const mediaItems = hasMediaPair
        ? pairedMedia
        : page.locator(
            ".detail-dialog .detail-media, .detail-dialog .scene-detail",
          );
      if (hasMediaPair) expect(await pairedMedia.count()).toBe(2);
      const itemCount = await mediaItems.count();
      expect(itemCount).toBeGreaterThan(0);
      for (let index = 0; index < itemCount; index += 1) {
        const itemBox = await mediaItems.nth(index).boundingBox();
        expect(itemBox).not.toBeNull();
        expect(itemBox!.height).toBeLessThanOrEqual(300);
        expect(itemBox!.width / itemBox!.height).toBeGreaterThan(1.15);
      }
    }

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `https://galteum.com/events/${eventId}`,
    );
  }

  expect(pageErrors).toEqual([]);
  expect(failedFirstPartyRequests).toEqual([]);
});
