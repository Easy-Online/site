// Geometry-based reading order and conservative table candidates. All data stays local.
export function groupPdfRows(items, tolerance = 3) {
  const ordered = items.filter(item => typeof item.str === 'string' && item.str.trim())
    .map(item => ({ str: item.str, x: Number(item.transform?.[4] || 0),
      y: Number(item.transform?.[5] || 0), width: Math.abs(Number(item.width || 0)),
      height: Math.abs(Number(item.height || 10)) }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const item of ordered) {
    const last = rows[rows.length - 1];
    const threshold = Math.min(tolerance, item.height * .35);
    if (last && Math.abs(last.y - item.y) <= threshold) last.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  rows.forEach(row => row.items.sort((a, b) => a.x - b.x));
  return rows;
}

function joinItems(items) {
  let text = '', previous;
  for (const item of items) {
    const gap = previous ? item.x - previous.x - previous.width : 0;
    if (previous && gap > Math.max(1, item.height * .12) && !/\s$/.test(text) && !/^\s/.test(item.str)) text += ' ';
    text += item.str;
    previous = item;
  }
  return text.replace(/\s+/g, ' ').trim();
}

export function linesFromPdfRows(rows) {
  return rows.map(row => joinItems(row.items)).filter(Boolean);
}

export function tablesFromPdfRows(rows, pageNumber) {
  // Require three adjacent rows with aligned cells. Prose and isolated totals
  // remain text; candidates are explicitly labelled for review, never inferred numbers.
  const tables = [];
  let run = [];
  function finish() {
    if (run.length >= 3) tables.push({ id: `page-${pageNumber}-table-${tables.length + 1}`,
      name: `Page ${pageNumber} table ${tables.length + 1}`, page: pageNumber,
      source: 'pdf-aligned-columns', reviewRequired: true,
      rows: run.map(row => row.cells.map(cell => joinItems(cell.items))) });
    run = [];
  }
  for (const row of rows) {
    const cells = [];
    for (const item of row.items) {
      const last = cells[cells.length - 1];
      const previous = last?.items[last.items.length - 1];
      if (!last || item.x - previous.x - previous.width > Math.max(14, item.height * 1.5))
        cells.push({ x: item.x, items: [item] });
      else last.items.push(item);
    }
    const previous = run[run.length - 1];
    const aligned = previous && cells.length === previous.cells.length &&
      cells.every((cell, index) => Math.abs(cell.x - previous.cells[index].x) <= 12) &&
      previous.y - row.y <= Math.max(36, row.items[0].height * 3);
    if (cells.length < 2 || (previous && !aligned)) finish();
    if (cells.length >= 2) run.push({ y: row.y, cells });
  }
  finish();
  return tables;
}
