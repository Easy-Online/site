# Easy Edit shared document engine

Easy Edit is the local document-processing layer for EasyFile. `easy-edit.html` is only one client of the engine; other EasyFile modules can hand documents to it through the same-origin document bus.

## Architecture

- `assets/js/easyfile-document-bus.js` — IndexedDB-backed document transport and recovery store.
- `assets/js/easy-edit/engine.js` — UI-independent adapter registry, document lifecycle, undo/redo, dirty state, export and recovery orchestration.
- `assets/js/easy-edit/adapters.js` — built-in PDF, image, HTML, text/data, DOCX and spreadsheet adapters.
- `assets/js/easy-edit/app.js` — Easy Edit page UI. It consumes the engine rather than implementing file logic directly.
- `assets/js/easyfile-edit-handoff.js` — helper that turns an EasyFile module view into an editable HTML handoff and opens it in Easy Edit.

## Adapter contract

An adapter supplies:

```js
{
  id,
  supports(descriptor),
  open(descriptor, engine),
  capabilities(model),
  snapshot(model),
  restore(model, snapshot),
  apply(model, action, payload, engine),
  export(model, format, current, engine)
}
```

Adapters may optionally implement `render()` and `recovery()` helpers. `Engine.registerAdapter()` allows future adapters to be added without modifying the editor shell.

## Document bus

The bus stores same-origin handoffs in IndexedDB rather than forcing download/re-upload cycles.

```js
const url = await EasyFileDocumentBus.handoff({
  name: "invoice-1047.html",
  mimeType: "text/html",
  sourceModule: "easy-invoice",
  data: html
});
location.href = url;
```

Easy Edit consumes `?handoff=<id>` automatically. Handoff records expire through routine cleanup and are capped at 50 MB. Recovery snapshots are capped more conservatively by the engine.

## Core engine usage

```js
const engine = EasyEditAdapters.registerAll(
  new EasyEdit.Engine({ bus: EasyFileDocumentBus })
);

await engine.openFile(file);
await engine.execute("set-text", { text: "Updated" });
engine.undo();
engine.redo();
const { blob, name } = await engine.export();
```

## Security model

- Files are processed in the browser unless a user explicitly exports or hands them to another same-origin EasyFile module.
- HTML preview runs in a sandboxed iframe.
- Preview CSP blocks scripts and restricts resources to data/blob, same-origin assets and the EasyFile-approved stylesheet/font CDNs.
- The document bus is same-origin browser storage, not cloud storage.
- Redaction is **not** yet represented as secure content removal; do not market visual overlays as redaction.

## Current format behaviour

- PDF: preview, per-page rotation, text overlays and PDF export. Overlay coordinates are stored in PDF page space so rotation does not change export placement.
- Images: rotation, horizontal flip, brightness, contrast, greyscale and text overlays; PNG/JPEG export.
- HTML: source + sandboxed live preview + basic visual element editing.
- Text/data: direct edit, JSON format/minify.
- DOCX: converts to editable HTML through Mammoth; complex Word layout is not guaranteed.
- XLS/XLSX: first worksheet converts to CSV for text editing.

## Next adapter-level priorities

1. PDF thumbnails, reorder/delete/merge/split and secure redaction.
2. Signature/form-field support.
3. Object/layer model for image and PDF annotations.
4. Spreadsheet grid adapter with multiple sheets and XLSX write-back.
5. Locally vendored dependencies + CSP/SRI hardening.
6. Web Worker processing for large PDFs and Office files.
