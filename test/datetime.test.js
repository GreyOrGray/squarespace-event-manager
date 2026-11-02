import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDate, parseTime, zonedToEpochMs, formatTime, formatSchedule,
} from "../extension/lib/datetime.js";

const TZ = "America/New_York";

test("parseDate accepts ISO and US formats", () => {
  assert.deepEqual(parseDate("2027-06-14"), { year: 2027, month: 6, day: 14 });
  assert.deepEqual(parseDate("6/14/2027"), { year: 2027, month: 6, day: 14 });
  assert.deepEqual(parseDate(" 6/4/27 "), { year: 2027, month: 6, day: 4 });
});

test("parseDate rejects impossible and unknown dates", () => {
  assert.equal(parseDate("2027-02-30"), null);
  assert.equal(parseDate("13/1/2027"), null);
  assert.equal(parseDate("June 14"), null);
  assert.equal(parseDate(""), null);
});

test("parseTime accepts common spellings", () => {
  assert.deepEqual(parseTime("9:00 AM"), { hour: 9, minute: 0 });
  assert.deepEqual(parseTime("9am"), { hour: 9, minute: 0 });
  assert.deepEqual(parseTime("4:30 p.m."), { hour: 16, minute: 30 });
  assert.deepEqual(parseTime("12:00 PM"), { hour: 12, minute: 0 });
  assert.deepEqual(parseTime("12:15 am"), { hour: 0, minute: 15 });
  assert.deepEqual(parseTime("13:30"), { hour: 13, minute: 30 });
  assert.deepEqual(parseTime("9:00:00 AM"), { hour: 9, minute: 0 });
});

test("parseTime rejects ambiguous or invalid times", () => {
  assert.equal(parseTime("9"), null);
  assert.equal(parseTime("13pm"), null);
  assert.equal(parseTime("9:75 am"), null);
  assert.equal(parseTime("noonish"), null);
});

test("summer times use daylight saving time (UTC-4 in New York), matching the fixture camp", () => {
  // The fixture camp stored startDate 1785166200414 and endDate 1785529800414.
  const start = zonedToEpochMs({ year: 2026, month: 7, day: 27 }, { hour: 11, minute: 30 }, TZ);
  const end = zonedToEpochMs({ year: 2026, month: 7, day: 31 }, { hour: 16, minute: 30 }, TZ);
  assert.equal(start, 1785166200000);
  assert.equal(end, 1785529800000);
});

test("winter times use standard time (UTC-5 in New York)", () => {
  const ms = zonedToEpochMs({ year: 2025, month: 12, day: 30 }, { hour: 11, minute: 0 }, TZ);
  assert.equal(new Date(ms).toISOString(), "2025-12-30T16:00:00.000Z");
});

test("formatTime matches the site's style", () => {
  assert.equal(formatTime({ hour: 11, minute: 30 }), "11:30am");
  assert.equal(formatTime({ hour: 16, minute: 30 }), "4:30pm");
  assert.equal(formatTime({ hour: 12, minute: 0 }), "12:00pm");
  assert.equal(formatTime({ hour: 0, minute: 5 }), "12:05am");
});

test("formatSchedule for a week and for one day", () => {
  assert.equal(
    formatSchedule({ month: 7, day: 27 }, { month: 7, day: 31 }, { hour: 11, minute: 30 }, { hour: 16, minute: 30 }),
    "July 27 - July 31 : 11:30am - 4:30pm",
  );
  assert.equal(
    formatSchedule({ year: 2025, month: 12, day: 30 }, { year: 2025, month: 12, day: 30 }, { hour: 11, minute: 0 }, { hour: 14, minute: 30 }),
    "December 30 : 11:00am - 2:30pm",
  );
});
