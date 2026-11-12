/* Browser-local, dependency-free DOCX writer for text and tables.
 * Office Open XML uses a ZIP container; entries below are stored uncompressed.
 * This is a recovery path when the external docx.js bundle is blocked/offline.
 */
(function (global) {
  "use strict";
  const encoder = new TextEncoder();
  const mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  function xmlText(value) {
    return String(value == null ? "" : value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uD800-\uDFFF]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }
  function paragraph(value, style) {
    const styleXml = style === "title" ? '<w:pPr><w:pStyle w:val="Title"/></w:pPr>'
      : style === "heading1" ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>'
      : style === "heading2" ? '<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>' : "";
    return '<w:p>' + styleXml + '<w:r><w:t xml:space="preserve">' +
      xmlText(value) + '</w:t></w:r></w:p>';
  }
  function tableXml(rows) {
    if (!Array.isArray(rows) || !rows.length) return "";
    const columns = Math.max(1, ...rows.map((r) => Array.isArray(r) ? r.length : 0));
    const grid = Array.from({ length: columns }, () => '<w:gridCol w:w="1800"/>').join("");
    const content = rows.map((row) => {
      const cells = Array.isArray(row) ? row : [row];
      return '<w:tr>' + Array.from({ length: columns }, (_, i) =>
        '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>' +
        paragraph(cells[i] == null ? "" : cells[i]) + '</w:tc>').join("") + '</w:tr>';
    }).join("");
    return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>' +
      '<w:tblBorders><w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/>' +
      '<w:left w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/>' +
      '<w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders>' +
      '</w:tblPr><w:tblGrid>' + grid + '</w:tblGrid>' + content + '</w:tbl>';
  }
  function documentXml(data) {
    const blocks = Array.isArray(data.blocks) ? data.blocks : [];
    const body = blocks.map((block) => block && block.type === "table"
      ? tableXml(block.rows) : paragraph(block && block.text, block && block.style)).join("");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body>' + (body || paragraph("")) +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>' +
      '</w:body></w:document>';
  }

  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    return c >>> 0;
  });
  function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function zip(files) {
    const localParts = [], centralParts = [];
    let offset = 0, centralSize = 0;
    for (const [name, content] of files) {
      const fileName = encoder.encode(name);
      const bytes = encoder.encode(content);
      if (bytes.length > 0xffffffff || fileName.length > 65535)
        throw new Error("DOCX export exceeds ZIP format limits.");
      const checksum = crc32(bytes);
      const local = new Uint8Array(30 + fileName.length);
      const l = new DataView(local.buffer);
      l.setUint32(0, 0x04034b50, true);
      l.setUint16(4, 20, true);
      l.setUint16(6, 0x0800, true); // UTF-8 filenames
      l.setUint32(14, checksum, true);
      l.setUint32(18, bytes.length, true);
      l.setUint32(22, bytes.length, true);
      l.setUint16(26, fileName.length, true);
      local.set(fileName, 30);
      localParts.push(local, bytes);

      const central = new Uint8Array(46 + fileName.length);
      const c = new DataView(central.buffer);
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);
      c.setUint32(16, checksum, true);
      c.setUint32(20, bytes.length, true);
      c.setUint32(24, bytes.length, true);
      c.setUint16(28, fileName.length, true);
      c.setUint32(42, offset, true);
      central.set(fileName, 46);
      centralParts.push(central);
      offset += local.length + bytes.length;
      centralSize += central.length;
    }
    if (offset + centralSize > 0xffffffff || files.length > 65535)
      throw new Error("DOCX export exceeds ZIP format limits.");
    const end = new Uint8Array(22);
    const e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, files.length, true);
    e.setUint16(10, files.length, true);
    e.setUint32(12, centralSize, true);
    e.setUint32(16, offset, true);
    return new Blob([...localParts, ...centralParts, end], { type: mime });
  }
  function createDocument(data) {
    if (!data || !Array.isArray(data.blocks)) throw new TypeError("DOCX blocks are required.");
    const types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="' +
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>';
    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="' +
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
      'Target="word/document.xml"/></Relationships>';
    return zip([
      ["[Content_Types].xml", types],
      ["_rels/.rels", rels],
      ["word/document.xml", documentXml(data)]
    ]);
  }
  global.EasyFileDocxFallback = Object.freeze({ createDocument });
})(window);
