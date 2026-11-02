// Compares the planned events with what's already on the site: which rows are new,
// which match an existing event, and what would change in the ones that match.
import { baseTitle } from "./events.js";
import { htmlToText } from "./template.js";

/** "YYYY-MM-DD" of a timestamp in the site's time zone. */
export function dayInZone(ms, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(ms));
}

const normTitle = (t) => String(t ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export function startOf(item) {
  return item.structuredContent?.startDate ?? item.startDate ?? null;
}

export function endOf(item) {
  return item.structuredContent?.endDate ?? item.endDate ?? null;
}

/** Squarespace adds a few stray milliseconds to saved times, so compare to the minute. */
const sameMinute = (a, b) => a !== null && b !== null && Math.floor(a / 60000) === Math.floor(b / 60000);

/**
 * Events for the full list, filtered and sorted.
 * when: "upcoming" (not over yet, soonest first), "past" (most recent first) or "all" (newest first).
 * status: a workflowState number, or null for any. text: part of the title, any case.
 */
export function filterEvents(items, { when = "upcoming", status = null, text = "", now = Date.now() } = {}) {
  const needle = String(text ?? "").trim().toLowerCase();
  const out = items.filter((i) => {
    const end = endOf(i) ?? startOf(i);
    if (when === "upcoming" && end !== null && end < now) return false;
    if (when === "past" && (end === null || end >= now)) return false;
    if (status !== null && i.workflowState !== status) return false;
    if (needle && !String(i.title ?? "").toLowerCase().includes(needle)) return false;
    return true;
  });
  const key = (i) => startOf(i) ?? 0;
  return out.sort(when === "upcoming" ? (a, b) => key(a) - key(b) : (a, b) => key(b) - key(a));
}

/** Only events. */
export function eventsOnly(items) {
  return items.filter((i) => i.recordType === 12);
}

/**
 * Location to copy into new events: from the most recently added event that has one.
 * @returns {{ location: object, from: object } | null}
 */
export function pickLocation(existing) {
  const withLocation = existing
    .filter((i) => i.location?.addressLine1)
    .sort((a, b) => (b.addedOn ?? 0) - (a.addedOn ?? 0));
  if (!withLocation.length) return null;
  const from = withLocation[0];
  const { mapZoom, mapLat, mapLng, markerLat, markerLng, addressTitle, addressLine1, addressLine2, addressCountry } = from.location;
  return {
    location: { mapZoom, mapLat, mapLng, markerLat, markerLng, addressTitle, addressLine1, addressLine2, addressCountry },
    from,
  };
}

/**
 * Location for new events. The season's address when it has a street address,
 * otherwise the one copied from the newest event. The map position is always
 * taken from the copied event, since the address alone doesn't give one.
 * @param {object} season
 * @param {{ location, from } | null} copied   from pickLocation()
 * @returns {{ location: object, source: "season" | "copied", from?: object } | null}
 */
export function eventLocation(season, copied) {
  const street = String(season.locationStreet ?? "").trim();
  if (!street) return copied ? { location: copied.location, source: "copied", from: copied.from } : null;
  const base = copied?.location ?? {};
  return {
    source: "season",
    location: {
      ...base,
      addressTitle: String(season.locationName ?? "").trim(),
      addressLine1: street,
      addressLine2: String(season.locationCity ?? "").trim(),
      addressCountry: base.addressCountry || "United States",
    },
  };
}

/** One line for showing a location. */
export function locationText(location) {
  return [location?.addressTitle, location?.addressLine1, location?.addressLine2].filter(Boolean).join(", ");
}

/**
 * File name of the event's featured image, which is also its flyer, from the
 * end of its address (spaces are saved as +). Null when it has none.
 */
export function flyerName(item) {
  if (item?.hasFileData === false) return null;
  const last = String(item?.assetUrl ?? "").split("?")[0].split("/").pop();
  if (!last || !/\.[a-z0-9]+$/i.test(last)) return null;
  try {
    return decodeURIComponent(last.replace(/\+/g, " "));
  } catch {
    return last;
  }
}

/** File names compared on letters and digits only, since Squarespace may tidy spaces and punctuation. */
export function sameFileName(a, b) {
  const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm(a) !== "" && norm(a) === norm(b);
}

/** What would change if `plan` were applied to the existing `item`. */
export function diffEvent(item, plan) {
  const changes = [];
  if (String(item.title ?? "").trim() !== plan.title) changes.push("title");
  if (!sameMinute(startOf(item), plan.start) || !sameMinute(endOf(item), plan.end)) changes.push("dates");
  if (htmlToText(item.excerpt?.html ?? "") !== htmlToText(plan.excerptHtml)) changes.push("text");
  // A blank Image column leaves the flyer alone.
  if (plan.image && !sameFileName(flyerName(item), plan.image)) changes.push("flyer");
  return changes;
}

/**
 * Matches each plan to an existing event and works out what would change.
 *
 * A plan matches an existing event when:
 *  - their web addresses are the same, and the title or the start day also agrees; or
 *  - their titles (ignoring the "full" marker) and start days are the same.
 * A web address that's taken by an unrelated event is an error, so nothing is overwritten by accident.
 *
 * Sets on each plan: `existing` (the matched item or null) and `changes` (list of what differs).
 */
export function checkAgainstSite(plans, existing, timeZone, fullTitleSuffix = "") {
  const keyOf = (title, start) => `${normTitle(baseTitle(title, fullTitleSuffix))}|${dayInZone(start, timeZone)}`;
  const byTitleDay = new Map();
  const bySlug = new Map();
  for (const item of existing) {
    const start = startOf(item);
    if (start !== null) byTitleDay.set(keyOf(item.title, start), item);
    if (item.urlId) bySlug.set(item.urlId, item);
  }

  for (const p of plans) {
    p.existing = null;
    p.changes = [];
    const titleDay = p.baseTitle && p.start !== null ? byTitleDay.get(keyOf(p.baseTitle, p.start)) : null;
    const slugItem = p.slug ? bySlug.get(p.slug) : null;

    let match = titleDay ?? null;
    if (!match && slugItem) {
      const titleAgrees = normTitle(baseTitle(slugItem.title, fullTitleSuffix)) === normTitle(p.baseTitle);
      const dayAgrees = p.start !== null && startOf(slugItem) !== null &&
        dayInZone(startOf(slugItem), timeZone) === dayInZone(p.start, timeZone);
      if (titleAgrees || dayAgrees) {
        match = slugItem;
      } else {
        p.errors.push(`The web address /events/${p.slug} is already used by "${slugItem.title}". Add a Slug column with a different address.`);
      }
    }

    if (match) {
      p.existing = match;
      if (p.start !== null) p.changes = diffEvent(match, p);
      // The flyer file is only needed to replace it.
      if (p.imageError && p.start !== null && !p.changes.includes("flyer")) {
        p.errors = p.errors.filter((e) => e !== p.imageError);
      }
    }
  }
  return plans;
}
