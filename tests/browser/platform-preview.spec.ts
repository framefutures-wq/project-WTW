import { expect, test } from "@playwright/test";

test("통합 서비스 미리보기는 PC·모바일에서 보이고 기존 행사 홈으로 돌아간다", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/platform-preview");
  await expect(page).toHaveURL(/\/platform-preview\/?$/);
  await expect(page.locator(".platform")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "당신의 일을 위한 도구" }),
  ).toBeVisible();

  const cards = page.locator(".platform-card");
  await expect(cards).toHaveCount(2);
  await expect(
    cards.getByRole("heading", { name: "도매상품 수익 발굴기" }),
  ).toBeVisible();
  await expect(
    cards.getByRole("heading", { name: "AI 상세페이지 연구소" }),
  ).toBeVisible();
  await expect(cards.locator(".platform-status")).toHaveText([
    "준비 중",
    "준비 중",
  ]);

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.screenshot({
    path: `test-results/ui-ci/platform-preview-${test.info().project.name}.png`,
    fullPage: true,
  });

  await page.getByRole("link", { name: /서비스 둘러보기/ }).click();
  await expect(page).toHaveURL(/#services$/);
  await page.getByRole("link", { name: /주말 행사 찾기/ }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/");
  await expect(page.locator(".platform")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "이번 주말, 어디 갈까?" }),
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
});
