import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SEASON, FIRST_SEASON_NAME, withDefaults, normalizeStore, seasonNames, seasonNameProblem,
  addSeason, renameSeason, deleteSeason, updateCurrent, exportSeasons, importSeasons,
} from "../extension/lib/season.js";
import { checkSeason } from "../extension/lib/events.js";
import { eventLocation, locationText, filterEvents } from "../extension/lib/site.js";

const COPIED = {
  from: { title: "Watercolor" },
  location: { addressTitle: "Example Art Studio", addressLine1: "100 Example Street", addressLine2: "Springfield, ST, 00000", addressCountry: "United States", mapLat: 40.5, mapLng: -100, mapZoom: 12 },
};

test("normalizeStore turns the older single setting into a named season", () => {
  const store = normalizeStore({ season: { earlyBirdDeadline: "4/20/2026" } });
  assert.deepEqual(Object.keys(store.seasons), [FIRST_SEASON_NAME]);
  assert.equal(store.current, FIRST_SEASON_NAME);
  assert.equal(store.seasons[FIRST_SEASON_NAME].earlyBirdDeadline, "4/20/2026");
  assert.equal(store.seasons[FIRST_SEASON_NAME].infoHeading, DEFAULT_SEASON.infoHeading);
});

test("normalizeStore keeps saved seasons and falls back when current is gone", () => {
  const raw = { seasons: { "Summer 2026": { infoHeading: "A" }, "Winter 2026": {} }, current: "Gone" };
  const store = normalizeStore(raw);
  assert.equal(store.current, "Summer 2026");
  assert.equal(store.seasons["Summer 2026"].infoHeading, "A");
  assert.equal(normalizeStore({ ...raw, current: "Winter 2026" }).current, "Winter 2026");
  assert.equal(normalizeStore(undefined).current, FIRST_SEASON_NAME);
});

test("seasonNames sorts with numbers in order", () => {
  const store = normalizeStore({ seasons: { "Summer 2027": {}, "summer 2026": {}, "Fall 2026": {} } });
  assert.deepEqual(seasonNames(store), ["Fall 2026", "summer 2026", "Summer 2027"]);
});

test("copying a season makes an independent copy and switches to it", () => {
  const store = normalizeStore({ seasons: { "Summer 2026": { earlyBirdDeadline: "4/20/2026" } } });
  const next = addSeason(store, " Summer 2027 ", store.seasons["Summer 2026"]);
  assert.equal(next.current, "Summer 2027");
  const edited = updateCurrent(next, { ...next.seasons["Summer 2027"], earlyBirdDeadline: "4/19/2027" });
  assert.equal(edited.seasons["Summer 2027"].earlyBirdDeadline, "4/19/2027");
  assert.equal(edited.seasons["Summer 2026"].earlyBirdDeadline, "4/20/2026");
});

test("season names can't be empty or taken, ignoring case", () => {
  const store = normalizeStore({ seasons: { "Summer 2026": {} } });
  assert.match(seasonNameProblem(store, "  "), /empty/);
  assert.match(seasonNameProblem(store, "summer 2026"), /already/);
  assert.equal(seasonNameProblem(store, "summer 2026", { except: "Summer 2026" }), null);
  assert.throws(() => addSeason(store, "SUMMER 2026", {}), /already/);
});

test("renaming keeps the settings and the current choice", () => {
  const store = normalizeStore({ seasons: { A: { infoHeading: "x" }, B: {} }, current: "A" });
  const next = renameSeason(store, "A", "Summer 2026");
  assert.deepEqual(seasonNames(next), ["B", "Summer 2026"]);
  assert.equal(next.current, "Summer 2026");
  assert.equal(next.seasons["Summer 2026"].infoHeading, "x");
});

test("deleting picks another season, and the last one stays", () => {
  const store = normalizeStore({ seasons: { A: {}, B: {} }, current: "B" });
  const next = deleteSeason(store, "B");
  assert.deepEqual(Object.keys(next.seasons), ["A"]);
  assert.equal(next.current, "A");
  assert.throws(() => deleteSeason(next, "A"), /last season/);
});

test("a backup file round-trips, and clashing names get (imported)", () => {
  const store = normalizeStore({ seasons: { "Summer 2026": { infoHeading: "mine" } } });
  const file = JSON.parse(JSON.stringify(exportSeasons(store)));
  const { store: merged, added } = importSeasons(store, file);
  assert.deepEqual(added, ["Summer 2026 (imported)"]);
  assert.equal(merged.seasons["Summer 2026"].infoHeading, "mine");
  assert.equal(merged.current, "Summer 2026");
  const again = importSeasons(merged, file);
  assert.deepEqual(again.added, ["Summer 2026 (imported 2)"]);
  assert.throws(() => importSeasons(store, { seasons: {} }), /isn't a season backup/);
});

test("location fields need a street address", () => {
  assert.deepEqual(checkSeason(withDefaults({ discounts: "" })).errors, []);
  assert.match(checkSeason(withDefaults({ discounts: "", locationCity: "Springfield" })).errors[0], /street address/);
  assert.deepEqual(checkSeason(withDefaults({ discounts: "", locationStreet: "1 Main St" })).errors, []);
});

test("eventLocation copies from the newest event unless the season has an address", () => {
  const copied = eventLocation(withDefaults({}), COPIED);
  assert.equal(copied.source, "copied");
  assert.equal(copied.location, COPIED.location);
  assert.equal(eventLocation(withDefaults({}), null), null);

  const own = eventLocation(withDefaults({ locationName: "Example Art Studio", locationStreet: "100 Example Street Suite 2", locationCity: "Springfield, ST, 00000" }), COPIED);
  assert.equal(own.source, "season");
  assert.equal(own.location.addressLine1, "100 Example Street Suite 2");
  assert.equal(own.location.mapLat, 40.5, "map position comes from the copied event");
  assert.equal(locationText(own.location), "Example Art Studio, 100 Example Street Suite 2, Springfield, ST, 00000");

  const noCopy = eventLocation(withDefaults({ locationStreet: "1 Main St" }), null);
  assert.deepEqual(noCopy.location, { addressTitle: "", addressLine1: "1 Main St", addressLine2: "", addressCountry: "United States" });
});

test("filterEvents splits upcoming and past, filters status and title, and sorts", () => {
  const ev = (id, start, end, ws, title = id) => ({ id, title, workflowState: ws, structuredContent: { startDate: start, endDate: end } });
  const now = 1000;
  const items = [ev("past1", 100, 200, 1), ev("past2", 300, 400, 4), ev("now", 900, 1100, 1, "Clay Camp"), ev("soon", 2000, 2100, 4, "clay day"), ev("later", 5000, 5100, 3)];
  assert.deepEqual(filterEvents(items, { when: "upcoming", now }).map((i) => i.id), ["now", "soon", "later"]);
  assert.deepEqual(filterEvents(items, { when: "past", now }).map((i) => i.id), ["past2", "past1"]);
  assert.deepEqual(filterEvents(items, { when: "all", now }).map((i) => i.id), ["later", "soon", "now", "past2", "past1"]);
  assert.deepEqual(filterEvents(items, { when: "all", status: 4, now }).map((i) => i.id), ["soon", "past2"]);
  assert.deepEqual(filterEvents(items, { when: "upcoming", text: " CLAY ", now }).map((i) => i.id), ["now", "soon"]);
});
