// Turns spreadsheet rows into planned events, with problems found along the way.
// Nothing here talks to Squarespace.
import {
  parseDate, parseTime, zonedToEpochMs, compareDates,
  formatSchedule, formatShortDate,
} from "./datetime.js";
import { buildCaptionHtml } from "./template.js";
import { splitLines } from "./season.js";

export const REQUIRED_COLUMNS = ["Title", "Start date", "Start time", "End time", "Description"];
export const KNOWN_COLUMNS = [
  ...REQUIRED_COLUMNS,
  "End date", "Ages", "Tuition", "Full", "Notice", "Notice detail", "Image", "Slug", "Tags", "Categories",
];

/** "yes", "y", "x", "true", "full" and "1" count as yes. */
export function isYes(text) {
  return /^(y|yes|x|true|full|1)$/i.test(String(text ?? "").trim());
}

/**
 * The title without the "full" marker, so "Watercolor **FULL**" and "Watercolor"
 * count as the same event. Removes the season's marker and the usual **FULL**.
 */
export function baseTitle(title, fullTitleSuffix = "") {
  let t = String(title ?? "").trim();
  for (const marker of [fullTitleSuffix.trim(), "**FULL**"]) {
    if (marker && t.toLowerCase().endsWith(marker.toLowerCase())) t = t.slice(0, -marker.length).trim();
  }
  return t;
}

const norm = (s) => String(s).trim().toLowerCase();

/** Case-insensitive cell lookup, so "start Date" still works. */
function cell(record, column) {
  const want = norm(column);
  for (const [k, v] of Object.entries(record)) {
    if (k !== "_line" && norm(k) === want) return String(v ?? "").trim();
  }
  return "";
}

/** Problems with the header row that stop the whole import. */
export function checkHeaders(headers) {
  const have = new Set(headers.map(norm));
  const missing = REQUIRED_COLUMNS.filter((c) => !have.has(norm(c)));
  const known = new Set(KNOWN_COLUMNS.map(norm));
  const unknown = headers.filter((h) => h.trim() !== "" && !known.has(norm(h)));
  return { missing, unknown };
}

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function splitList(text) {
  return String(text ?? "").split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}

/** Problems with the season settings that affect every row. */
export function checkSeason(season) {
  const errors = [];
  const usesDeadline = splitLines(season.discounts).some((l) => l.includes("{deadline}"));
  let deadline = null;
  if (season.earlyBirdDeadline.trim()) {
    deadline = parseDate(season.earlyBirdDeadline);
    if (!deadline) errors.push(`Early bird deadline "${season.earlyBirdDeadline}" isn't a date. Use 4/20/2027 or 2027-04-20.`);
  } else if (usesDeadline) {
    errors.push("The discounts mention {deadline}, but no early bird deadline is set.");
  }
  if (!String(season.locationStreet ?? "").trim() && (String(season.locationName ?? "").trim() || String(season.locationCity ?? "").trim())) {
    errors.push("The location needs a street address. Fill it in, or clear the other location fields.");
  }
  return { errors, deadline };
}

/**
 * @param {object} record          from toRecords()
 * @param {object} season          from withDefaults()
 * @param {object} opts
 * @param {{year,month,day}|null} opts.deadline    parsed early bird deadline
 * @param {Set<string>|null} opts.imageNames       lower-cased names of chosen image files, or null if none chosen
 * @param {{year,month,day}} opts.today
 */
export function planEvent(record, season, { deadline = null, imageNames = null, today } = {}) {
  const errors = [];
  const warnings = [];
  const line = record._line;

  const rawTitle = cell(record, "Title");
  const base = baseTitle(rawTitle, season.fullTitleSuffix);
  if (!base) errors.push("Title is empty.");
  // Full if the Full column says so, or if the title already carries the marker.
  const full = isYes(cell(record, "Full")) || (base !== rawTitle);
  const title = base && full ? `${base}${season.fullTitleSuffix}` : base;

  const startDateText = cell(record, "Start date");
  const startDate = parseDate(startDateText);
  if (!startDateText) errors.push("Start date is empty.");
  else if (!startDate) errors.push(`Start date "${startDateText}" isn't a date. Use 2027-06-14 or 6/14/2027.`);

  const endDateText = cell(record, "End date");
  let endDate = startDate;
  if (endDateText) {
    endDate = parseDate(endDateText);
    if (!endDate) errors.push(`End date "${endDateText}" isn't a date. Use 2027-06-18 or 6/18/2027.`);
  }
  if (startDate && endDate && compareDates(endDate, startDate) < 0) {
    errors.push("End date is before the start date.");
  }

  const startTimeText = cell(record, "Start time");
  const endTimeText = cell(record, "End time");
  const startTime = parseTime(startTimeText);
  const endTime = parseTime(endTimeText);
  if (!startTimeText) errors.push("Start time is empty.");
  else if (!startTime) errors.push(`Start time "${startTimeText}" isn't a time. Use 9:00 AM.`);
  if (!endTimeText) errors.push("End time is empty.");
  else if (!endTime) errors.push(`End time "${endTimeText}" isn't a time. Use 12:00 PM.`);
  if (startTime && endTime && endTime.hour * 60 + endTime.minute <= startTime.hour * 60 + startTime.minute) {
    errors.push("End time is not after the start time.");
  }

  const description = cell(record, "Description");
  if (!description) warnings.push("Description is empty.");

  const ages = cell(record, "Ages");
  const tuition = cell(record, "Tuition");
  if (!ages) warnings.push("Ages is empty, so it's left out of Camp Info.");
  if (!tuition) warnings.push("Tuition is empty, so it's left out of Camp Info.");

  const image = cell(record, "Image");
  // Only needed when the flyer gets uploaded, so checkAgainstSite drops this error
  // for events already on the site that have this flyer.
  let imageError = null;
  if (image) {
    if (imageNames === null) imageError = `Image "${image}" is listed, but no image files are chosen. Choose them above, or clear the Image column.`;
    else if (!imageNames.has(image.toLowerCase())) imageError = `Image "${image}" isn't among the chosen image files.`;
    if (imageError) errors.push(imageError);
  }

  if (startDate && today && compareDates(startDate, today) < 0) {
    warnings.push("This event starts in the past.");
  }
  if (deadline && startDate && compareDates(deadline, startDate) > 0) {
    warnings.push("The early bird deadline is after this event starts.");
  }

  let start = null;
  let end = null;
  if (startDate && endDate && startTime && endTime) {
    start = zonedToEpochMs(startDate, startTime, season.timeZone);
    end = zonedToEpochMs(endDate, endTime, season.timeZone);
  }

  const infoItems = [];
  if (ages) infoItems.push(/^ages?\b/i.test(ages) ? ages : `Ages ${ages}`);
  if (startDate && endDate && startTime && endTime) {
    infoItems.push(formatSchedule(startDate, endDate, startTime, endTime));
  }
  if (tuition) {
    const amount = /^\d/.test(tuition) ? `$${tuition}` : tuition;
    infoItems.push(/^tuition/i.test(tuition) ? tuition : `Tuition: ${amount}`);
  }

  // A full camp gets the season's "full" notice unless the row has its own.
  const notice = cell(record, "Notice") || (full ? season.fullNotice : "");
  const noticeDetail = cell(record, "Notice detail") || (full ? season.fullNoticeDetail : "");
  const captionHtml = buildCaptionHtml(
    { notice, noticeDetail, description, infoItems },
    season,
    deadline ? formatShortDate(deadline) : "",
  );

  let slug = slugify(cell(record, "Slug"));
  if (!slug && base) {
    slug = slugify(base);
    if (startDate && !slug.includes(String(startDate.year))) slug += `-${startDate.year}`;
  }

  return {
    line,
    title,
    baseTitle: base,
    full,
    image,
    imageError,
    slug,
    startDate,
    endDate,
    startTime,
    endTime,
    start,
    end,
    tags: splitList(cell(record, "Tags")),
    categories: splitList(cell(record, "Categories")),
    captionHtml,
    excerptHtml: captionHtml,
    errors,
    warnings,
  };
}

/** Plans every row and adds problems that span rows, such as duplicates. */
export function planAll(records, season, opts) {
  const plans = records.map((r) => planEvent(r, season, opts));

  const seenTitle = new Map();
  const seenSlug = new Map();
  for (const p of plans) {
    if (p.baseTitle && p.start !== null) {
      const key = `${p.baseTitle.toLowerCase()}|${p.start}`;
      if (seenTitle.has(key)) p.errors.push(`Same title and start as line ${seenTitle.get(key)}.`);
      else seenTitle.set(key, p.line);
    }
    if (p.slug) {
      if (seenSlug.has(p.slug)) p.errors.push(`Same web address (${p.slug}) as line ${seenSlug.get(p.slug)}. Add a Slug column to tell them apart.`);
      else seenSlug.set(p.slug, p.line);
    }
  }
  return plans;
}
