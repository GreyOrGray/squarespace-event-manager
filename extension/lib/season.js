// Settings that are the same for every class in one import, entered once in the panel.
// The defaults are example text for a summer camp; change them in the panel.

export const DEFAULT_SEASON = Object.freeze({
  earlyBirdDeadline: "",
  infoHeading: "Camp Info",
  discountsHeading: "Discounts (one per family):",
  // One discount per line. {deadline} is replaced with the early bird deadline.
  discounts: [
    "Early bird (register by {deadline}): 10% off tuition",
    "Siblings: 10% off tuition",
  ].join("\n"),
  // Used for rows marked Full.
  fullTitleSuffix: " **FULL**",
  fullNotice: "*** Camp is Full ***",
  fullNoticeDetail: "Please email about waitlist options",
  // Paragraphs separated by a blank line.
  closing: [
    "Students should bring a snack, water and a sketchbook. Aprons are provided, but please wear clothes that can get paint on them.",
    "Our camps are a relaxed, welcoming place to make friends and learn about art.",
  ].join("\n\n"),
  // Optional. With a street address, new events use this location instead of
  // copying the one from the newest event on the site.
  locationName: "",
  locationStreet: "",
  locationCity: "",
});

export const SEASON_FIELDS = [
  { key: "earlyBirdDeadline", label: "Early bird deadline", hint: "For example 4/20/2027. Fills in {deadline} below.", multiline: false },
  { key: "infoHeading", label: "Info heading", multiline: false },
  { key: "discountsHeading", label: "Discounts heading", multiline: false },
  { key: "discounts", label: "Discounts", hint: "One per line. Leave empty to leave out the discounts section.", multiline: true },
  { key: "closing", label: "Closing paragraphs", hint: "Separate paragraphs with a blank line.", multiline: true },
  { key: "fullTitleSuffix", label: "Added to the title of a full camp", hint: "For rows with yes in the Full column.", multiline: false },
  { key: "fullNotice", label: "Full camp notice", hint: "Heading above the description, unless the row has its own Notice.", multiline: false },
  { key: "fullNoticeDetail", label: "Full camp notice detail", multiline: false },
  { key: "locationName", label: "Location name", hint: "Optional, like Example Art Studio. Leave the location fields empty to copy the location from the newest event on the site. Used for new events only.", multiline: false },
  { key: "locationStreet", label: "Street address", hint: "For example 100 Main Street, Suite 2.", multiline: false },
  { key: "locationCity", label: "City, state and ZIP", hint: "For example Springfield, IL, 62701.", multiline: false },
];

export function withDefaults(saved) {
  const out = { ...DEFAULT_SEASON };
  for (const key of Object.keys(DEFAULT_SEASON)) {
    if (typeof saved?.[key] === "string") out[key] = saved[key];
  }
  return out;
}

export function splitLines(text) {
  return String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

export function splitParagraphs(text) {
  return String(text ?? "")
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

// ---- Saved seasons
// Kept in storage as { seasons: { name: settings }, current: name }.

export const FIRST_SEASON_NAME = "My season";
export const EXPORT_FORMAT = "squarespace-event-importer seasons";

/** Saved seasons in a known shape. Also accepts the older single `season` setting. */
export function normalizeStore(raw) {
  const seasons = {};
  if (raw?.seasons && typeof raw.seasons === "object") {
    for (const [name, s] of Object.entries(raw.seasons)) {
      if (name.trim()) seasons[name.trim()] = withDefaults(s);
    }
  }
  if (!Object.keys(seasons).length) seasons[FIRST_SEASON_NAME] = withDefaults(raw?.season ?? null);
  const current = typeof raw?.current === "string" && Object.hasOwn(seasons, raw.current)
    ? raw.current
    : seasonNames({ seasons })[0];
  return { seasons, current };
}

export function seasonNames(store) {
  return Object.keys(store.seasons).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

/** Why `name` can't be used for a season, or null if it can. */
export function seasonNameProblem(store, name, { except = null } = {}) {
  const n = String(name ?? "").trim();
  if (!n) return "The name can't be empty.";
  const clash = Object.keys(store.seasons).find((k) => k !== except && k.toLowerCase() === n.toLowerCase());
  return clash ? `There's already a season called "${clash}".` : null;
}

function requireName(store, name, opts) {
  const problem = seasonNameProblem(store, name, opts);
  if (problem) throw new Error(problem);
  return String(name).trim();
}

/** Adds a season (a copy of `settings`) and makes it the current one. */
export function addSeason(store, name, settings) {
  const n = requireName(store, name);
  return { seasons: { ...store.seasons, [n]: withDefaults(settings) }, current: n };
}

export function renameSeason(store, from, to) {
  const n = requireName(store, to, { except: from });
  const seasons = {};
  for (const [k, v] of Object.entries(store.seasons)) seasons[k === from ? n : k] = v;
  return { seasons, current: store.current === from ? n : store.current };
}

export function deleteSeason(store, name) {
  if (Object.keys(store.seasons).length <= 1) throw new Error("The last season can't be deleted.");
  const seasons = { ...store.seasons };
  delete seasons[name];
  const current = store.current === name ? seasonNames({ seasons })[0] : store.current;
  return { seasons, current };
}

export function updateCurrent(store, settings) {
  return { ...store, seasons: { ...store.seasons, [store.current]: settings } };
}

/** Everything saved, in the shape written to a backup file. */
export function exportSeasons(store) {
  return { format: EXPORT_FORMAT, version: 1, seasons: store.seasons };
}

/**
 * Adds the seasons from a backup file. A season whose name is taken is added
 * with " (imported)" after its name, so nothing saved is overwritten.
 * @returns {{ store, added: string[] }}
 */
export function importSeasons(store, data) {
  if (data?.format !== EXPORT_FORMAT || !data.seasons || typeof data.seasons !== "object") {
    throw new Error("That file isn't a season backup from the event manager.");
  }
  let out = store;
  const added = [];
  for (const [name, settings] of Object.entries(data.seasons)) {
    if (!name.trim() || !settings || typeof settings !== "object") continue;
    let n = name.trim();
    for (let i = 1; seasonNameProblem(out, n); i++) n = `${name.trim()} (imported${i > 1 ? ` ${i}` : ""})`;
    out = { seasons: { ...out.seasons, [n]: withDefaults(settings) }, current: out.current };
    added.push(n);
  }
  if (!added.length) throw new Error("That backup file has no seasons in it.");
  return { store: out, added };
}
