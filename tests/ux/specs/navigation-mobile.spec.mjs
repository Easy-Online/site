import { test, expect } from '@playwright/test';

for (const pageUrl of ['/easy-converter-enterprise.html', '/easy-converter.html']) {
  test(`mobile navigation and theme controls work on ${pageUrl}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(pageUrl);

    const theme = page.locator('[data-theme-toggle]');
    await expect(theme).toBeVisible();
    await expect(theme.locator('i.fa-solid')).toHaveCount(1);
    await expect(theme).toHaveAttribute('aria-label', /Switch to (light|dark) theme/);
    const initialTheme = await page.locator('html').getAttribute('data-theme');
    await theme.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', initialTheme === 'dark' ? 'light' : 'dark');

    const toggle = page.getByRole('button', { name: 'Open navigation menu' });
    const menu = page.getByRole('navigation', { name: 'Mobile navigation' });
    await expect(toggle).toBeVisible();
    await expect(menu).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Enterprise Converter', exact: true })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Home', exact: true })).toBeVisible();

    const position = await menu.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { top: bounds.top, bottom: bounds.bottom, width: bounds.width, viewportWidth: innerWidth, viewportHeight: innerHeight };
    });
    expect(position.top).toBeGreaterThanOrEqual(50);
    expect(position.top).toBeLessThan(150);
    expect(position.width).toBeLessThanOrEqual(position.viewportWidth + 2);
    expect(position.bottom).toBeLessThanOrEqual(position.viewportHeight + 2);

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await page.locator('main').click({ position: { x: 5, y: 5 } });
    await expect(menu).toBeHidden();
  });
}
