import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

function twoPagePdf() {
  const contents = (page) => {
    const lines = [
      'EasyFile enterprise offline DOCX test',
      'Invoice total 1250 ZAR',
      'Page ' + page + ' sample line'
    ];
    return 'BT /F1 12 Tf 48 770 Td 0 -20 Td ' +
      lines.map((line, i) => (i ? '0 -20 Td ' : '') + '(' + line + ') Tj ').join('') + 'ET';
  };
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    (() => { const s = contents(1); return '<< /Length ' + Buffer.byteLength(s) + ' >>\\nstream\\n' + s + '\\nendstream'; })(),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 7 0 R >>',
    (() => { const s = contents(2); return '<< /Length ' + Buffer.byteLength(s) + ' >>\\nstream\\n' + s + '\\nendstream'; })()
  ];
  let pdf = '%PDF-1.4\\n';
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += (i + 1) + ' 0 obj\\n' + object + '\\nendobj\\n';
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += 'xref\\n0 ' + (objects.length + 1) + '\\n0000000000 65535 f \\n';
  offsets.slice(1).forEach(offset => { pdf += String(offset).padStart(10, '0') + ' 00000 n \\n'; });
  pdf += 'trailer\\n<< /Root 1 0 R /Size ' + (objects.length + 1) + ' >>\\nstartxref\\n' + xrefOffset + '\\n%%EOF';
  return Buffer.from(pdf, 'ascii');
}

test('enterprise DOCX exports locally with a blocked remote library', async ({ page }) => {
  await page.route(/cdn\\.jsdelivr\\.net\\/npm\\/docx@/, route => route.abort());
  await page.goto('/easy-converter-enterprise.html');
  await expect(page.locator('#fileInput')).toBeAttached();
  await page.locator('#fileInput').setInputFiles({
    name: 'two-page-invoice.pdf',
    mimeType: 'application/pdf',
    buffer: twoPagePdf()
  });
  await expect(page.locator('#analyzeBtn')).toBeEnabled();
  await page.locator('#analyzeBtn').click();
  await expect(page.locator('#statusText')).toContainText('Analysis completed successfully', { timeout: 90000 });
  await expect(page.locator('#pageCount')).toHaveText('2');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-format="docx"]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('two-page-invoice.docx');
  const entries = unzipSync(await readFile(await download.path()));
  const xml = strFromU8(entries['word/document.xml']);
  expect(xml).toContain('EasyFile enterprise offline DOCX test');
  expect(xml).toContain('Invoice total 1250 ZAR');
  expect(xml).toContain('Page 2');
  await expect(page.locator('#logBody')).toContainText('browser-local export engine (no CDN required)');
  await expect(page.locator('#logBody')).toContainText('DOCX export completed.');
});
