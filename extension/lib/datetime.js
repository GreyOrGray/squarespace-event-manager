// Dates and times from the spreadsheet, converted to Squarespace timestamps
// (milliseconds since 1970 UTC) in the site's time zone.

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Accepts 2027-06-14, 6/14/2027 and 6/14/27 (Excel's usual formats).
 * @returns {{year:number, month:number, day:number} | null}
 */
export function parseDate(text) {
  const s = String(text ?? "").trim();
  let y, mo, d, m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    [y, mo, d] = [+m[1], +m[2], +m[3]];
  } else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/))) {
    [mo, d, y] = [+m[1], +m[2], +m[3]];
    if (y < 100) y += 2000;
  } else {
    return null;
  }
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return null;
  }
  return { year: y, month: mo, day: d };
}

/**
 * Accepts 9:00 AM, 9am, 9 a.m., 11:30pm, 13:30, and Excel's 9:00:00 AM.
 * A bare number without am/pm ("9") is rejected as ambiguous.
 * @returns {{hour:number, minute:number} | null}
 */
export function parseTime(text) {
  const s = String(text ?? "").trim().toLowerCase().replace(/\./g, "");
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm|a|p)?$/);
  if (!m) return null;
  let hour = +m[1];
  const minute = m[2] ? +m[2] : 0;
  const ampm = m[4];
  if (minute > 59) return null;
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    if (ampm[0] === "a") {
      if (hour === 12) hour = 0;
    } else if (hour !== 12) {
      hour += 12;
    }
  } else {
    if (!m[2] || hour > 23) return null;
  }
  return { hour, minute };
}

/** How far the zone is ahead of UTC at the given instant, in ms. */
function zoneOffsetMs(utcMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type) => +parts.find((p) => p.type === type).value;
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - utcMs;
}

/**
 * Wall-clock date and time in `timeZone` to a UTC timestamp in ms.
 * Handles daylight saving: July in New York is UTC-4, December is UTC-5.
 */
export function zonedToEpochMs(date, time, timeZone) {
  const naive = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute);
  const first = naive - zoneOffsetMs(naive, timeZone);
  return naive - zoneOffsetMs(first, timeZone);
}

/** "11:30am", "4:30pm", "9:00am" */
export function formatTime({ hour, minute }) {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")}${hour < 12 ? "am" : "pm"}`;
}

/** "July 27" */
export function formatMonthDay({ month, day }) {
  return `${MONTHS[month - 1]} ${day}`;
}

/** "4/20/2027" */
export function formatShortDate({ year, month, day }) {
  return `${month}/${day}/${year}`;
}

/** "2027-06-14" */
export function formatIsoDate({ year, month, day }) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function compareDates(a, b) {
  return (a.year - b.year) || (a.month - b.month) || (a.day - b.day);
}

/**
 * The "Camp Info" line, matching the existing events:
 * "July 27 - July 31 : 11:30am - 4:30pm", or "December 30 : 11:00am - 2:30pm" for one day.
 */
export function formatSchedule(startDate, endDate, startTime, endTime) {
  const days = compareDates(startDate, endDate) === 0
    ? formatMonthDay(startDate)
    : `${formatMonthDay(startDate)} - ${formatMonthDay(endDate)}`;
  return `${days} : ${formatTime(startTime)} - ${formatTime(endTime)}`;
}
