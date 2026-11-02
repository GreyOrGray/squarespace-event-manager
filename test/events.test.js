import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseCsv, toRecords } from "../extension/lib/csv.js";
import { planEvent, planAll, checkHeaders, checkSeason, slugify, baseTitle, isYes } from "../extension/lib/events.js";
import { withDefaults } from "../extension/lib/season.js";
import { escapeHtml } from "../extension/lib/template.js";

const TODAY = { year: 2026, month: 10, day: 30 };

function row(fields) {
  return { _line: 2, Title: "Clay Creatures", "Start date": "2027-06-14", "End date": "2027-06-18",
    "Start time": "9:00 AM", "End time": "12:00 PM", Ages: "6-9", Tuition: "300",
    Description: "Kids sculpt.", ...fields };
}

const season = { ...withDefaults({ earlyBirdDeadline: "4/20/2027" }), timeZone: "America/New_York" };
const deadline = checkSeason(season).deadline;

/** Text of each block-level element, in order, ignoring markup. */
function blockTexts(html) {
  const out = [];
  for (const m of html.matchAll(/<(h3|h4|p)\b[^>]*>(.*?)<\/\1>/g)) {
    out.push(m[2].replace(/<br>/g, "\n").replace(/<[^>]+>/g, "")
      .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
  }
  return out;
}

test("checkHeaders reports missing and unknown columns", () => {
  const { missing, unknown } = checkHeaders(["title", "Start Date", "Start time", "Colour"]);
  assert.deepEqual(missing, ["End time", "Description"]);
  assert.deepEqual(unknown, ["Colour"]);
});

test("checkSeason requires a deadline when discounts use it", () => {
  assert.match(checkSeason(withDefaults({})).errors[0], /no early bird deadline/);
  assert.deepEqual(checkSeason(withDefaults({ earlyBirdDeadline: "", discounts: "Siblings 10%" })).errors, []);
  assert.match(checkSeason(withDefaults({ earlyBirdDeadline: "soon" })).errors[0], /isn't a date/);
});

test("a good row has no errors and gets times, slug and info list", () => {
  const p = planEvent(row(), season, { deadline, today: TODAY });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.warnings, []);
  assert.equal(new Date(p.start).toISOString(), "2027-06-14T13:00:00.000Z");
  assert.equal(new Date(p.end).toISOString(), "2027-06-18T16:00:00.000Z");
  assert.equal(p.slug, "clay-creatures-2027");
  const texts = blockTexts(p.captionHtml);
  assert.ok(texts.includes("Ages 6-9"));
  assert.ok(texts.includes("June 14 - June 18 : 9:00am - 12:00pm"));
  assert.ok(texts.includes("Tuition: $300"));
  assert.ok(texts.includes("Early bird (register by 4/20/2027): 10% off tuition"));
  assert.equal(p.excerptHtml, p.captionHtml);
});

test("end date defaults to the start date", () => {
  const p = planEvent(row({ "End date": "" }), season, { deadline, today: TODAY });
  assert.deepEqual(p.endDate, p.startDate);
  assert.ok(blockTexts(p.captionHtml).includes("June 14 : 9:00am - 12:00pm"));
});

test("bad dates and times are errors with helpful messages", () => {
  const p = planEvent(row({ "Start date": "June 14", "End time": "noon" }), season, { deadline, today: TODAY });
  assert.ok(p.errors.some((e) => e.includes('Start date "June 14" isn\'t a date')));
  assert.ok(p.errors.some((e) => e.includes('End time "noon" isn\'t a time')));
  assert.equal(p.start, null);
});

test("end before start is an error", () => {
  assert.ok(planEvent(row({ "End date": "2027-06-10" }), season, { today: TODAY }).errors.includes("End date is before the start date."));
  assert.ok(planEvent(row({ "End time": "8:00 AM" }), season, { today: TODAY }).errors.includes("End time is not after the start time."));
});

test("image checks: listed images must be among the chosen files", () => {
  assert.deepEqual(planEvent(row({ Image: "" }), season, { deadline, today: TODAY }).errors, []);
  assert.match(planEvent(row({ Image: "clay.png" }), season, { deadline, imageNames: null, today: TODAY }).errors[0], /no image files are chosen/);
  assert.match(planEvent(row({ Image: "clay.png" }), season, { deadline, imageNames: new Set(["other.png"]), today: TODAY }).errors[0], /isn't among/);
  const ok = planEvent(row({ Image: "Clay.PNG" }), season, { deadline, imageNames: new Set(["clay.png"]), today: TODAY });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.image, "Clay.PNG");
});

test("isYes", () => {
  for (const y of ["yes", "Y", "x", "TRUE", "full", "1", " yes "]) assert.ok(isYes(y), y);
  for (const n of ["", "no", "n", "0", "maybe"]) assert.ok(!isYes(n), n);
});

test("baseTitle strips the full marker", () => {
  assert.equal(baseTitle("Watercolor **FULL**", " **FULL**"), "Watercolor");
  assert.equal(baseTitle("Watercolor (Full)", " (Full)"), "Watercolor");
  assert.equal(baseTitle("Watercolor **full**", ""), "Watercolor");
  assert.equal(baseTitle("Watercolor", " **FULL**"), "Watercolor");
});

test("a row marked Full gets the title marker and the full notice", () => {
  const p = planEvent(row({ Full: "yes" }), season, { deadline, today: TODAY });
  assert.equal(p.title, "Clay Creatures **FULL**");
  assert.equal(p.baseTitle, "Clay Creatures");
  assert.equal(p.full, true);
  assert.equal(p.slug, "clay-creatures-2027");
  const texts = blockTexts(p.captionHtml);
  assert.equal(texts[0], "*** Camp is Full ***");
  assert.equal(texts[1], "Please email about waitlist options");
});

test("a row's own notice wins over the full notice", () => {
  const p = planEvent(row({ Full: "yes", Notice: "Waitlist open" }), season, { deadline, today: TODAY });
  assert.equal(blockTexts(p.captionHtml)[0], "Waitlist open");
  assert.equal(blockTexts(p.captionHtml)[1], "Please email about waitlist options");
});

test("a title typed with **FULL** counts as full, and the slug ignores the marker", () => {
  const p = planEvent(row({ Title: "Clay Creatures **FULL**" }), season, { deadline, today: TODAY });
  assert.equal(p.full, true);
  assert.equal(p.title, "Clay Creatures **FULL**");
  assert.equal(p.slug, "clay-creatures-2027");
});

test("a full and a not-full row for the same camp are duplicates", () => {
  const plans = planAll([row(), { ...row({ Full: "yes" }), _line: 3 }], season, { deadline, today: TODAY });
  assert.ok(plans[1].errors.some((e) => e.includes("Same title and start as line 2")));
});

test("past events and late deadlines are warnings", () => {
  const p = planEvent(row({ "Start date": "2026-06-01", "End date": "2026-06-05" }), season, { deadline, today: TODAY });
  assert.ok(p.warnings.includes("This event starts in the past."));
  assert.ok(p.warnings.includes("The early bird deadline is after this event starts."));
});

test("text is escaped so the spreadsheet can't inject markup", () => {
  const p = planEvent(row({ Description: 'Bring <script> & "stuff"' }), season, { deadline, today: TODAY });
  assert.ok(p.captionHtml.includes("Bring &lt;script&gt; &amp; &quot;stuff&quot;"));
  assert.equal(escapeHtml("<a>"), "&lt;a&gt;");
});

test("planAll flags duplicate rows and duplicate slugs", () => {
  const plans = planAll([row(), { ...row(), _line: 3 }], season, { deadline, today: TODAY });
  assert.ok(plans[1].errors.some((e) => e.includes("Same title and start as line 2")));
  assert.ok(plans[1].errors.some((e) => e.includes("Same web address")));
});

test("slugify", () => {
  assert.equal(slugify("Summer Camp: Watercolor **FULL**"), "summer-camp-watercolor-full");
  assert.equal(slugify("Kids' Café Night"), "kids-cafe-night");
});

test("the template reproduces the fixture camp's caption text", async () => {
  const editor = JSON.parse(await readFile(new URL("./fixtures/example-event.editor.json", import.meta.url), "utf8"));
  const block = editor.body.layout.rows[0].columns[0].blocks[0];
  const expected = blockTexts(block.value.description.html);

  const csv = await readFile(new URL("../examples/template.csv", import.meta.url), "utf8");
  const [rec] = toRecords(parseCsv(csv)).records;
  const s2026 = { ...withDefaults({ earlyBirdDeadline: "4/20/2025" }), timeZone: "America/New_York" };
  const p = planEvent(
    { ...rec, Notice: "*** Camp is Full ***", "Notice detail": "Please email about waitlist options" },
    s2026,
    { deadline: checkSeason(s2026).deadline, today: { year: 2026, month: 1, day: 1 } },
  );

  assert.deepEqual(blockTexts(p.captionHtml), expected);
});

test("planEvent keeps the image error separately, so it can be dropped for events on the site", () => {
  const p = planEvent(row({ Image: "clay.png" }), season, { deadline, imageNames: null, today: TODAY });
  assert.equal(p.errors[0], p.imageError);
  assert.equal(planEvent(row({ Image: "" }), season, { deadline, today: TODAY }).imageError, null);
});
