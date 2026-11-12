import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import AxeBuilder from '@axe-core/playwright';

const formats = ['pdf', 'docx', 'xlsx', 'csv', 'txt', 'json', 'xml', 'html', 'md'];
const marker = 'EasyFile invoice 65804024';

async function open(page) {
  await page.goto('/easy-converter.html');
  await page.waitForFunction(() => window.jspdf?.jsPDF && window.XLSX && window.Papa);
  await expect(page.locator('#libraryHealth')).toContainText('DOCX export: ready');
}

async function pdfFixture(page, count = 3, scan = false, password = false) {
  const bytes = await page.evaluate(({ count, scan, password, marker }) => {
    const doc = new window.jspdf.jsPDF({ unit: 'pt', ...(password ? { encryption: { userPassword: 'test-password', ownerPassword: 'owner-password' } } : {}) });
    for (let n = 1; n <= count; n++) {
      if (n > 1) doc.addPage();
      if (scan) {
        const c = document.createElement('canvas'); c.width = 1500; c.height = 700;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.fillStyle = '#000'; ctx.font = '42px Arial';
        ctx.fillText(marker, 50, 100); ctx.fillText('Amount 1250.00 ZAR', 50, 200); ctx.fillText('Client Example Business', 50, 300);
        doc.addImage(c.toDataURL('image/jpeg', .92), 'JPEG', 30, 30, 535, 250);
      } else {
        doc.setFontSize(12); doc.text(marker, 40, 40); doc.text(`Page ${n} reference`, 40, 60);
        for (let row = 0; row < 5; row++) {
          doc.text(row ? `Service ${row}` : 'Description', 40, 110 + row * 22);
          doc.text(row ? String(row) : 'Quantity', 300, 110 + row * 22);
          doc.text(row ? `${row * 125}.00` : 'Amount', 420, 110 + row * 22);
        }
        doc.text('Invoice total 1250.00 ZAR for professional services reviewed by Example Business.', 40, 280, { maxWidth: 500 });
      }
    }
    return Array.from(new Uint8Array(doc.output('arraybuffer')));
  }, { count, scan, password, marker });
  return { name: scan ? 'scanned-invoice.pdf' : 'invoice.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) };
}

async function analyze(page, file) {
  await page.locator('#fileInput').setInputFiles(file);
  await expect(page.locator('#analyzeBtn')).toBeEnabled();
  await page.locator('#analyzeBtn').click();
  await expect(page.locator('#statusText')).toHaveText('Analysis complete', { timeout: 120000 });
  await expect(page.locator('#analyzeBtn')).toBeEnabled();
}

async function download(page, format) {
  const pending = page.waitForEvent('download');
  await page.locator(`[data-format="${format}"]`).click();
  const file = await pending;
  expect(await file.failure()).toBeNull();
  expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
  const bytes = await readFile(await file.path());
  expect(bytes.length).toBeGreaterThan(10);
  await expect(page.locator('#analyzeBtn')).toBeEnabled();
  return bytes;
}

async function verify(page, format, bytes, text) {
  if (format === 'pdf') {
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const extracted = await page.evaluate(async bytes => {
      const lib = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.min.mjs');
      const pdf = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
      try { const text = []; for (let n = 1; n <= pdf.numPages; n++) text.push((await (await pdf.getPage(n)).getTextContent()).items.map(i => i.str).join(' ')); return text.join('\n'); }
      finally { await pdf.destroy(); }
    }, [...bytes]);
    expect(extracted).toContain(text);
  } else if (format === 'docx') {
    const entries = unzipSync(bytes);
    expect(Object.keys(entries)).toContain('[Content_Types].xml');
    const xml = strFromU8(entries['word/document.xml']);
    expect(xml).toContain(text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'));
    expect(await page.evaluate(xml => !new DOMParser().parseFromString(xml, 'application/xml').querySelector('parsererror'), xml)).toBe(true);
  } else if (format === 'xlsx') {
    const result = await page.evaluate(bytes => {
      const wb = window.XLSX.read(new Uint8Array(bytes), { type: 'array' });
      return { names: wb.SheetNames, text: wb.SheetNames.map(n => window.XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n') };
    }, [...bytes]);
    expect(result.names).toContain('Content'); expect(result.text).toContain(text);
  } else if (format === 'json') {
    expect(JSON.parse(bytes.toString()).text).toContain(text);
  } else if (format === 'xml') {
    const result = await page.evaluate(xml => { const doc = new DOMParser().parseFromString(xml, 'application/xml'); return { error: !!doc.querySelector('parsererror'), text: doc.querySelector('easyFileConversion > text')?.textContent }; }, bytes.toString());
    expect(result.error).toBe(false); expect(result.text).toContain(text);
  } else if (format === 'html') {
    const result = await page.evaluate(html => { const doc = new DOMParser().parseFromString(html, 'text/html'); return { scripts: doc.querySelectorAll('script').length, text: doc.body.textContent }; }, bytes.toString());
    expect(result.scripts).toBe(0); expect(result.text).toContain(text);
  } else expect(bytes.toString()).toContain(text);
}

test('three-page PDF analysis preserves pages, text and aligned table cells; all nine exports are valid', async ({ page }) => {
  await open(page); const file = await pdfFixture(page);
  await analyze(page, file);
  await expect(page.locator('#unitCount')).toHaveText('3');
  await expect(page.locator('#ocrCount')).toHaveText('0');
  await expect(page.locator('#tableCount')).toHaveText('3');
  await expect(page.locator('#editor')).toHaveValue(/Service 4 4 500.00/);
  for (const format of formats) {
    const bytes = await download(page, format); await verify(page, format, bytes, format === 'csv' ? 'Service 4' : marker);
    if (format === 'pdf') expect(bytes.equals(file.buffer)).toBe(true);
    if (format === 'json') { const m = JSON.parse(bytes); expect(m.units).toHaveLength(3); expect(m.tables[0].rows[4]).toEqual(['Service 4', '4', '500.00']); }
  }
});

test('all nine corrected-text exports contain edits and omit stale structured values', async ({ page }) => {
  await open(page); await analyze(page, await pdfFixture(page, 1));
  const corrected = 'Corrected amount 1300 ZAR & <reviewed>';
  await page.locator('#editor').fill(corrected + '\nClient cafe');
  for (const format of formats) {
    const bytes = await download(page, format); await verify(page, format, bytes, corrected);
    if (format === 'json') { const m = JSON.parse(bytes); expect(m.tables).toEqual([]); expect(m.units).toEqual([]); }
  }
});

test('DOCX export succeeds when the external engine is blocked', async ({ page }) => {
  await page.route(/cdn\.jsdelivr\.net\/npm\/docx@/, route => route.abort());
  await open(page); await analyze(page, { name: 'unicode.txt', mimeType: 'text/plain', buffer: Buffer.from('Café João č 漢字 & <xml>') });
  await verify(page, 'docx', await download(page, 'docx'), 'Café João č 漢字 & <xml>');
});

test('scanned PDF and image OCR recover invoice text', async ({ page }) => {
  test.setTimeout(180000);
  await open(page); await analyze(page, await pdfFixture(page, 1, true));
  await expect(page.locator('#ocrCount')).toHaveText('1');
  await expect(page.locator('#editor')).toHaveValue(/1250\.00/);
  await verify(page, 'docx', await download(page, 'docx'), '1250.00');
  const image = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1000; c.height = 220; const ctx = c.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1000, 220); ctx.fillStyle = 'black'; ctx.font = '40px Arial'; ctx.fillText('EasyFile invoice 1250.00 ZAR', 20, 90); return c.toDataURL('image/png').split(',')[1]; });
  await analyze(page, { name: 'scan.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await expect(page.locator('#editor')).toHaveValue(/1250\.00/);
});

test('bad PDF, encrypted PDF, page limit and scans with OCR disabled give recoverable errors', async ({ page }) => {
  await open(page);
  const cases = [
    { file: { name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 broken bytes') }, warning: /PDF|Invalid/i },
    { file: await pdfFixture(page, 1, false, true), warning: /password protected/i },
    { file: await pdfFixture(page, 251), warning: /250 pages/ },
    { file: await pdfFixture(page, 1, true), warning: /Enable OCR/ }
  ];
  await page.locator('#ocrMode').selectOption('never');
  for (const { file, warning } of cases) {
    await page.locator('#fileInput').setInputFiles(file); await page.locator('#analyzeBtn').click();
    await expect(page.locator('#statusText')).toHaveText('Conversion failed');
    await expect(page.locator('#warningBox')).toContainText(warning);
    for (const format of formats) await expect(page.locator(`[data-format="${format}"]`)).toBeDisabled();
  }
  await analyze(page, { name: 'recovery.txt', mimeType: 'text/plain', buffer: Buffer.from(marker) });
});

test('sparse PDF retains embedded text when OCR fails and retrying analysis clears old results', async ({ page }) => {
  await open(page); const file = await pdfFixture(page, 1);
  await analyze(page, file);
  await page.route(/tesseract\.js@/, route => route.abort());
  await page.locator('#ocrMode').selectOption('always'); await page.locator('#analyzeBtn').click();
  await expect(page.locator('#statusText')).toHaveText('Analysis complete');
  await expect(page.locator('#warningBox')).toContainText('embedded text was retained');
  await expect(page.locator('#editor')).toHaveValue(new RegExp(marker));
  await page.locator('#fileInput').setInputFiles(await pdfFixture(page, 1, true));
  await page.locator('#analyzeBtn').click(); await expect(page.locator('#statusText')).toHaveText('Conversion failed');
  await expect(page.locator('[data-format="json"]')).toBeDisabled();
});

test('cancel stops OCR and permits another file without stale exports', async ({ page }) => {
  await open(page); await page.locator('#fileInput').setInputFiles(await pdfFixture(page, 2, true));
  await page.locator('#analyzeBtn').click(); await page.locator('#cancelBtn').click();
  await expect(page.locator('#statusText')).toHaveText('Conversion cancelled', { timeout: 45000 });
  await expect(page.locator('[data-format="json"]')).toBeDisabled();
  await analyze(page, { name: 'next.txt', mimeType: 'text/plain', buffer: Buffer.from(marker) });
});

test('DOCX, XLSX/XLS, CSV/TSV and text/JSON/XML/HTML/Markdown input routes all export valid files', async ({ page }) => {
  test.setTimeout(180000); await open(page);
  await analyze(page, { name: 'fixture.txt', mimeType: 'text/plain', buffer: Buffer.from(marker) });
  const docx = await download(page, 'docx');
  const workbooks = await page.evaluate(marker => {
    const wb = window.XLSX.utils.book_new();
    for (const name of ['Summary', 'Content', 'Invoices']) window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet([['Description', 'Amount'], [marker, 1250]]), name);
    return ['xlsx', 'biff8'].map(bookType => Array.from(new Uint8Array(window.XLSX.write(wb, { bookType, type: 'array' }))));
  }, marker);
  const files = [
    ['docx', docx], ['xlsx', Buffer.from(workbooks[0])], ['xls', Buffer.from(workbooks[1])],
    ['csv', `Description,Amount\n${marker},1250`], ['tsv', `Description\tAmount\n${marker}\t1250`],
    ['txt', marker], ['md', '# ' + marker], ['json', JSON.stringify([{ description: marker, amount: 1250 }])],
    ['xml', `<invoice>${marker}</invoice>`], ['html', `<h1>${marker}</h1><script>window.BAD=true</script>`]
  ];
  for (const [ext, data] of files) {
    await analyze(page, { name: `fixture.${ext}`, mimeType: 'application/octet-stream', buffer: Buffer.isBuffer(data) ? data : Buffer.from(data) });
    await expect(page.locator('#editor')).toHaveValue(new RegExp(marker));
    expect(await page.evaluate(() => window.BAD)).toBeUndefined();
    for (const format of formats) await verify(page, format, await download(page, format), marker);
  }
});

test('keyboard upload, copy, reset, log clearing and dependency failures remain usable', async ({ page, context }) => {
  await open(page); await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const chooser = page.waitForEvent('filechooser'); await page.locator('#dropzone').focus(); await page.keyboard.press('Enter');
  await (await chooser).setFiles({ name: 'keyboard.txt', mimeType: 'text/plain', buffer: Buffer.from(marker) });
  await page.locator('#analyzeBtn').click(); await expect(page.locator('#statusText')).toHaveText('Analysis complete');
  await page.locator('#copyBtn').click(); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(marker);
  await page.locator('#clearLogBtn').click(); await expect(page.locator('#logBody')).toHaveText('');
  await page.locator('#resetBtn').click(); await expect(page.locator('#editor')).toHaveValue('');
  await page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/(pdf\.js|xlsx|PapaParse|jspdf)\//, route => route.abort());
  await page.reload(); await analyze(page, { name: 'offline.txt', mimeType: 'text/plain', buffer: Buffer.from(marker) });
  await expect(page.locator('[data-format="xlsx"]')).toBeDisabled();
  await expect(page.locator('[data-format="pdf"]')).toBeDisabled();
  for (const format of ['docx', 'csv', 'txt', 'json', 'xml', 'html', 'md']) await verify(page, format, await download(page, format), marker);
});

test('light and dark converter controls pass accessibility checks without viewport overflow', async ({ page }) => {
  await open(page); await analyze(page, { name: 'a11y.txt', mimeType: 'text/plain', buffer: Buffer.from(marker) });
  for (const theme of ['light', 'dark']) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('[data-theme-toggle]').first().click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      await Promise.all(document.querySelector('#main-content').getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
    });
    const results = await new AxeBuilder({ page }).include('#main-content').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
  }
});

test('50-page PDFs survive repeated analysis and four concurrent browser sessions', async ({ page, browser }, testInfo) => {
  test.setTimeout(180000); await open(page); const file = await pdfFixture(page, 50); const timings = [];
  for (let i = 0; i < 3; i++) {
    const start = Date.now(); await analyze(page, file); timings.push(Date.now() - start);
    await expect(page.locator('#unitCount')).toHaveText('50');
    const model = JSON.parse(await download(page, 'json')); expect(model.units).toHaveLength(50); expect(model.tables).toHaveLength(50);
    expect(model.units[49].text).toContain('Page 50 reference');
  }
  const concurrent = await Promise.all(Array.from({ length: 4 }, async () => {
    const other = await browser.newPage(); const started = Date.now();
    try { await open(other); await analyze(other, file); await expect(other.locator('#unitCount')).toHaveText('50'); return Date.now() - started; }
    finally { await other.close(); }
  }));
  await testInfo.attach('load-results.json', { body: JSON.stringify({ pages: 50, sequentialMs: timings, concurrentMs: concurrent }), contentType: 'application/json' });
});
