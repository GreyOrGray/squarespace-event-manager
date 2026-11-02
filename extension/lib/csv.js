// Minimal RFC 4180 CSV parser. Handles quoted fields, escaped quotes (""),
// commas and line breaks inside quotes, CRLF/LF/CR line endings, and a UTF-8 BOM.

/**
 * @param {string} text
 * @returns {string[][]} rows of fields
 */
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i++;
    } else if (c === ",") {
      row.push(field);
      field = "";
      i++;
    } else if (c === "\r" || c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += c === "\r" && text[i + 1] === "\n" ? 2 : 1;
    } else {
      field += c;
      i++;
    }
  }

  if (inQuotes) {
    throw new Error("CSV ends inside a quoted field. Check for a missing closing quote.");
  }

  // Last line without a trailing newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Turn parsed rows into objects keyed by the header row.
 * Header names are trimmed. Rows where every cell is blank are skipped.
 * Each record keeps its 1-based spreadsheet line number as `_line` for error messages.
 * (Line numbers count CSV records, so a cell with line breaks still counts as one line.)
 *
 * @param {string[][]} rows
 * @returns {{ headers: string[], records: Array<Record<string, string> & { _line: number }> }}
 */
export function toRecords(rows) {
  if (rows.length === 0) return { headers: [], records: [] };

  const headers = rows[0].map((h) => h.trim());
  const records = [];

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.every((c) => c.trim() === "")) continue;

    const rec = { _line: r + 1 };
    headers.forEach((h, idx) => {
      if (h === "") return;
      rec[h] = (cells[idx] ?? "").trim();
    });
    records.push(rec);
  }

  return { headers, records };
}
