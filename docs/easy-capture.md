# Easy Capture

Easy Capture is the local-first ingestion layer for receipts and supplier invoices in EasyFile.

## Workflow

1. Capture from a phone camera, file picker or drag-and-drop.
2. Store the original image/PDF in IndexedDB and metadata in `localStorage` under `easy.capture.v1`.
3. Calculate a SHA-256 fingerprint and flag exact duplicate source documents.
4. Extract text from text-based PDFs with PDF.js or perform browser OCR with Tesseract.js. Scanned PDFs fall back to page rendering + OCR.
5. Run deterministic field extraction for supplier, VAT registration number, document number, date, category, subtotal, VAT and total.
6. Present the original document next to editable extracted fields with a confidence score.
7. Validate required fields before marking a capture ready.
8. Post approved records into the existing Easy Expenses store (`easy.expenses.v1`) while retaining the capture ID for traceability.

## Storage and privacy

- Original source files are written to IndexedDB database `easyfile.capture.blobs.v1`, object store `documents`.
- Capture metadata is written to `localStorage` under `easy.capture.v1`.
- OCR runs in the browser. Tesseract.js and PDF.js are loaded from CDN only when required.
- Easy Capture does not upload the source document to an EasyFile server.
- Metadata backups intentionally exclude original binary documents; original files remain in the current browser unless the user separately saves them.
- A 25 MB per-file guard is applied by the progressive enhancement layer to avoid accidental browser-storage exhaustion.

## Expense mapping

A posted capture creates an Easy Expenses record with:

- `id`
- `captureId`
- `date`
- `supplier`
- `category`
- `amountExcl`
- `vatPct`
- `vatAmt`
- `amountIncl`
- `reference`
- `notes`
- `createdAt`
- `updatedAt`

This preserves compatibility with Easy VAT and Easy Cash Flow, which already consume `easy.expenses.v1`.

## Status model

- `needs-review`
- `ready`
- `processed`
- `duplicate`
- `rejected`

## Current extraction design

Extraction is evidence-first and deterministic. OCR/PDF text is preserved and the parser derives likely fields from that source text. The system does not invent financial values when no supporting value exists in the source evidence.

## Future cloud extension

The local schema is designed so that a future authenticated EasyFile service can replace local blobs with encrypted object storage while keeping the same capture workflow. API keys for external document-recognition providers must never be embedded in the browser page; provider integrations should be proxied through the EasyFile application API.
