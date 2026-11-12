# Easy Converter verification

The navigation deployment workflow runs the converter browser suite before publishing
and again against `https://www.easyfile.co.za` after Pages deployment. A failed
pre-deployment test prevents publishing. A failed live test marks the deployment
workflow as failed and retains traces/screenshots for diagnosis.

Run locally after serving the repository root on port 8765:

```sh
npm ci --prefix tests/ux
cd tests/ux && npx playwright install chromium
cd ../..
npm --prefix tests/ux test -- --workers=2
```

To test production, set `EASYFILE_TEST_BASE_URL=https://www.easyfile.co.za` before
running the same command. Tests generate synthetic documents in memory; no customer
document is required or uploaded. Every export is downloaded and checked for valid
contents: PDFs are reopened with PDF.js, DOCX packages are unzipped and their XML
parsed, XLSX workbooks are reopened with SheetJS, and structured/text formats are
parsed and checked against expected values.

Coverage includes desktop/mobile navigation, all nine exports from text-based PDFs,
edited text, DOCX/XLSX/XLS/CSV/TSV/TXT/Markdown/JSON/XML/HTML inputs, scanned PDFs,
image OCR, the local DOCX fallback, missing libraries, invalid/encrypted/over-limit
PDFs, cancellation, reset, copy, keyboard upload, and WCAG A/AA checks in both themes.
Load coverage repeats 50-page analysis three times and runs four separate browser
sessions concurrently. Timing measurements are attached to test results.

Limits: 100 MB per input, 250 PDF pages, and 16 million rendered pixels per OCR page.
Aligned PDF table candidates require review. Complex layouts, handwritten scans,
merged cells, and arbitrary OCR accuracy are not guaranteed. After text edits,
original tables and page units are omitted from exports to prevent stale values.
Unedited PDF export preserves the original bytes; edited PDF export generates a
text document. External parsers and OCR language data require network access.
