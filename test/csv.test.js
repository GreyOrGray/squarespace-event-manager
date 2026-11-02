import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseCsv, toRecords } from "../extension/lib/csv.js";

test("parses simple rows", () => {
  assert.deepEqual(parseCsv("a,b\n1,2\n"), [["a", "b"], ["1", "2"]]);
});

test("handles missing trailing newline", () => {
  assert.deepEqual(parseCsv("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
});

test("handles CRLF and lone CR", () => {
  assert.deepEqual(parseCsv("a\r\n1\r2"), [["a"], ["1"], ["2"]]);
});

test("handles quoted commas, quotes and line breaks", () => {
  const text = 'title,desc\n"Clay, Kids","She said ""hi""\n\nSecond paragraph"\n';
  assert.deepEqual(parseCsv(text), [
    ["title", "desc"],
    ["Clay, Kids", 'She said "hi"\n\nSecond paragraph'],
  ]);
});

test("strips a UTF-8 BOM so the first header matches", () => {
  const { headers } = toRecords(parseCsv("﻿Title,Date\nx,y"));
  assert.equal(headers[0], "Title");
});

test("keeps empty fields", () => {
  assert.deepEqual(parseCsv("a,,c\n"), [["a", "", "c"]]);
});

test("throws on an unclosed quote", () => {
  assert.throws(() => parseCsv('a\n"oops'), /quoted field/);
});

test("toRecords trims, skips blank rows and records line numbers", () => {
  const rows = parseCsv(" Title , Ages \nPottery, 10+ \n,\nWatercolor,7-12\n");
  const { headers, records } = toRecords(rows);
  assert.deepEqual(headers, ["Title", "Ages"]);
  assert.deepEqual(records, [
    { _line: 2, Title: "Pottery", Ages: "10+" },
    { _line: 4, Title: "Watercolor", Ages: "7-12" },
  ]);
});

test("toRecords fills missing trailing cells with empty strings", () => {
  const { records } = toRecords(parseCsv("A,B,C\n1\n"));
  assert.deepEqual(records, [{ _line: 2, A: "1", B: "", C: "" }]);
});

for (const name of ["template.csv", "test-events.csv"]) {
  test(`${name} parses with every expected column`, async () => {
    const text = await readFile(new URL(`../examples/${name}`, import.meta.url), "utf8");
    const { headers, records } = toRecords(parseCsv(text));
    for (const col of ["Title", "Start date", "End date", "Start time", "End time", "Ages", "Tuition", "Description"]) {
      assert.ok(headers.includes(col), `missing column ${col}`);
    }
    assert.ok(records.length >= 1);
  });
}
