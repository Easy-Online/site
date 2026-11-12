import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const pageUrl = '/easy-converter.html';
const enterpriseUrl = '/easy-converter-enterprise.html';
const textFile = {
  name: 'ux-finance-check.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from('EasyFile UX test invoice\nInvoice total: 1250.00 ZAR\nClient: Example Pty Ltd', 'utf8')
};

test('navigation, theme switching and accessible content remain available', async ({ page }) => {
  await page.goto(pageUrl);
  const heading = page.getByRole('heading', { name: 'Convert business files accurately and locally.' });
  await expect(heading).toBeVisible();
  const toggle = page.locator('[data-theme-toggle]').first();
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', /dark|light/);
  const selected = await page.locator('html').getAttribute('data-theme');
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', selected === 'dark' ? 'light' : 'dark');
  await expect(page.locator('#main-content')).toBeVisible();
  // Scrollable regions may exist, but the document itself must not overflow the viewport.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});

test('file input, editable extraction, and DOCX download work with the local fallback', async ({ page }) => {
  // Reproduce the incident: third-party DOCX library is blocked. Local fallback must still export.
  await page.route(/cdn\.jsdelivr\.net\/npm\/docx@/, route => route.abort());
  await page.goto(pageUrl);
  await expect(page.locator('[data-format="docx"]')).toBeDisabled();
  await page.locator('#fileInput').setInputFiles(textFile);
  await expect(page.locator('#analyzeBtn')).toBeEnabled();
  await page.locator('#analyzeBtn').click();
  await expect(page.locator('#statusText')).toContainText('Analysis complete');
  await expect(page.locator('#editor')).toHaveValue(/Invoice total: 1250\.00 ZAR/);
  await expect(page.locator('[data-format="docx"]')).toBeEnabled();
  await page.locator('#editor').fill('Corrected invoice amount: 1300 ZAR\nClient: Example Pty Ltd');
  const promise = page.waitForEvent('download');
  await page.locator('[data-format="docx"]').click();
  const download = await promise;
  expect(download.suggestedFilename()).toBe('ux-finance-check.docx');
  const path = await download.path();
  const bytes = await readFile(path);
  expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304');
  // The offline ZIP is stored, making the OpenXML payload directly inspectable.
  expect(bytes.toString('utf8')).toContain('Corrected invoice amount: 1300 ZAR');
  await expect(page.locator('#libraryHealth')).toContainText('DOCX export: ready');
});

test('reset disables exports and invalid input produces a clear warning', async ({ page }) => {
  await page.goto(pageUrl);
  await page.locator('#fileInput').setInputFiles({ name: 'unsupported.xyz', mimeType: 'application/octet-stream', buffer: Buffer.from('invalid') });
  await expect(page.locator('#warningBox')).toContainText('Unsupported source format');
  await expect(page.locator('[data-format="docx"]')).toBeDisabled();
  await page.locator('#fileInput').setInputFiles(textFile);
  await page.locator('#analyzeBtn').click();
  await expect(page.locator('#statusText')).toContainText('Analysis complete');
  await page.locator('#resetBtn').click();
  await expect(page.locator('[data-format="docx"]')).toBeDisabled();
  await expect(page.locator('#fileMeta')).toContainText('No file selected yet');
});

test('enterprise converter retains navigable interface and responsive export panel', async ({ page }) => {
  await page.goto(enterpriseUrl);
  await expect(page.getByRole('heading', { name: 'Convert PDFs into business-ready files.' })).toBeVisible();
  await expect(page.locator('[data-format="docx"]')).toBeDisabled();
  const navCount = await page.locator('.easyfile-nav').count();
  expect(navCount).toBe(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});
