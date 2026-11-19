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
  const footer = page.locator('.platform-footer');
  await expect(footer).toHaveCSS('background-color', 'rgb(11, 13, 16)');
  await expect(footer).toHaveCSS('border-top-left-radius', '0px');
  await expect(page.getByRole('heading', { name: /필요한 일을/ })).toBeVisible();

  const cards = page.locator('.platform-service-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.getByRole('heading', { name: '도매상품 수익 발굴기' })).toBeVisible();
  await expect(cards.getByRole('heading', { name: 'AI 상세페이지 연구소' })).toBeVisible();
  await expect(cards.locator('.platform-service-status')).toHaveText(['이용 가능 · 로그인 필요', '준비 중']);
  const wholesale = cards.first().getByRole('link', { name: '도매상품 발굴기 이용하기' });
  await expect(wholesale).toHaveAttribute('href', 'https://wholesale.galteum.com/wholesale/');
  await expect(cards.last().locator('a, button')).toHaveCount(0);
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

  await page.route('https://wholesale.galteum.com/wholesale/', route => route.fulfill({ status: 200, contentType: 'text/plain', body: 'Mock destination' }));
  await wholesale.click();
  await expect(page).toHaveURL('https://wholesale.galteum.com/wholesale/');

  // Existing sample homepage remains independently routable during preview review.
  await page.goto('/');
  await expect(platform).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '이번 주말, 어디 갈까?' })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('운영 루트 셸은 새 플랫폼 렌더링으로 전환하고 여행 화면을 숨긴다', async ({ page }) => {
  await page.route('http://127.0.0.1:8787/', async (route) => {
    const original = await route.fetch();
    const html = (await original.text()).replace(
      '</head>',
      '<meta name="galteum-platform-root" content="true" /></head>',
    );
    await route.fulfill({ response: original, body: html });
  });
  await page.goto('/');
  await expect(page.locator('.platform')).toBeVisible();
  await expect(page.getByRole('heading', { name: /상품 발굴부터/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: '이번 주말, 어디 갈까?' })).toHaveCount(0);
  await expect(page.locator('.region-quick-trigger')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '도매상품 발굴기 이용하기' })).toHaveAttribute('href', 'https://wholesale.galteum.com/wholesale/');
  await expect(page.locator('.platform-service-card').last().locator('a, button')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
