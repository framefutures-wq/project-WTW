import { expect, test } from '@playwright/test';

test('통합 플랫폼은 다크톤 두 서비스를 안내하고 기존 행사 화면과 분리된다', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/platform-preview');
  await expect(page).toHaveURL(/\/platform-preview\/?$/);
  await expect(page).toHaveTitle('GALTEUM | 비즈니스를 위한 디지털 도구');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /도매상품 발굴/);
  await expect(page.getByRole('heading', { name: /상품 발굴부터,\s*상세페이지까지\./ })).toBeVisible();

  const platform = page.locator('.platform');
  await expect(platform).toBeVisible();
  await expect(platform).toHaveCSS('background-color', 'rgb(11, 13, 16)');
  await expect(page.getByRole('heading', { name: /필요한 일을/ })).toBeVisible();

  const cards = page.locator('.platform-service-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.getByRole('heading', { name: '도매상품 수익 발굴기' })).toBeVisible();
  await expect(cards.getByRole('heading', { name: 'AI 상세페이지 연구소' })).toBeVisible();
  await expect(cards.locator('.platform-service-status')).toHaveText(['준비 중', '준비 중']);
  await expect(cards.locator('a, button')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /주말 행사 찾기/ })).toHaveCount(0);
  await expect(page.getByText(/여행|주말 행사|축제/)).toHaveCount(0);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({
    path: `test-results/ui-ci/platform-preview-${test.info().project.name}.png`,
    fullPage: true,
  });

  await page.getByRole('link', { name: /서비스 살펴보기/ }).click();
  await expect(page).toHaveURL(/#services$/);
  await expect(cards.first()).toBeVisible();

  // Existing production homepage remains independently routable during preview review.
  await page.goto('/');
  await expect(platform).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '이번 주말, 어디 갈까?' })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
