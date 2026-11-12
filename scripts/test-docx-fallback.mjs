// Run with: node scripts/test-docx-fallback.mjs
// Exercise the actual browser-local DOCX export script without a network or CDN.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { TextEncoder } from "node:util";
import { Blob } from "node:buffer";

const source = readFileSync(new URL("../assets/js/easyfile-docx-fallback.js", import.meta.url), "utf8");
const context = { window: {}, TextEncoder, Blob, Uint8Array, DataView };
runInNewContext(source, context, { filename: "easyfile-docx-fallback.js" });
const createDocument = context.window.EasyFileDocxFallback?.createDocument;
assert.equal(typeof createDocument, "function", "local DOCX writer should register");

const headers = ["Name", "Amount", "Comment"];
const rows = Array.from({ length: 48 }, (_, i) => ["Row " + (i + 1), String(i * 125), 'Ampersand & <xml> "quote"']);
const blocks = [
  { type: "paragraph", style: "title", text: "EasyFile – café & <finance>" },
  { type: "paragraph", style: "heading1", text: "Page 1" },
  { type: "paragraph", text: "Unicode: č € 漢字; special characters & < >" },
  { type: "table", rows: [headers, ...rows] },
  { type: "paragraph", style: "heading2", text: "End of document" }
];
const blob = createDocument({ blocks });
assert.equal(blob.type, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
assert.ok(blob.size > 5000);
const data = Buffer.from(await blob.arrayBuffer());
assert.equal(data.readUInt32LE(0), 0x04034b50, "valid ZIP local header");
const zipEntries = new Map();
let cursor = 0;
while (cursor + 30 < data.length && data.readUInt32LE(cursor) === 0x04034b50) {
  const compressed = data.readUInt32LE(cursor + 18);
  const length = data.readUInt16LE(cursor + 26);
  const extra = data.readUInt16LE(cursor + 28);
  const name = data.subarray(cursor + 30, cursor + 30 + length).toString("utf8");
  const start = cursor + 30 + length + extra;
  zipEntries.set(name, data.subarray(start, start + compressed).toString("utf8"));
  cursor = start + compressed;
}
assert.equal(data.readUInt32LE(cursor), 0x02014b50, "central directory must follow file entries");
assert.deepEqual([...zipEntries.keys()].sort(), ["[Content_Types].xml", "_rels/.rels", "word/document.xml"].sort());
assert.match(zipEntries.get("[Content_Types].xml"), /wordprocessingml\.document\.main\+xml/);
assert.match(zipEntries.get("_rels/.rels"), /Target="word\/document\.xml"/);
const word = zipEntries.get("word/document.xml");
assert.match(word, /EasyFile – café &amp; &lt;finance&gt;/);
assert.match(word, /Unicode: č € 漢字; special characters &amp; &lt; &gt;/);
assert.match(word, /Ampersand &amp; &lt;xml&gt; &quot;quote&quot;/);
assert.match(word, /Row 48/);
assert.match(word, /<w:tbl>/);
assert.equal((word.match(/<w:tr>/g) || []).length, 49);
assert.equal((word.match(/<w:tc>/g) || []).length, 147);
assert.match(word, /<w:sectPr>/);
assert.doesNotMatch(word, /<script>/);
assert.throws(() => createDocument({}), /blocks/i);
console.log("Offline DOCX package, table rows, XML escaping and ZIP structure verified");
