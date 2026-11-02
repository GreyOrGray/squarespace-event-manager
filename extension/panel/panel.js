// Importer panel: an overlay inside the Squarespace editor page.
// Season settings and a spreadsheet in, a checked preview, then draft events created
// or existing events updated. Events are only published when asked to, with the
// status change at the bottom.
import { parseCsv, toRecords } from "../lib/csv.js";
import { checkHeaders, checkSeason, planAll } from "../lib/events.js";
import {
  SEASON_FIELDS, withDefaults, normalizeStore, seasonNames, seasonNameProblem, addSeason, renameSeason,
  deleteSeason, updateCurrent, exportSeasons, importSeasons,
} from "../lib/season.js";
import { formatIsoDate, formatTime } from "../lib/datetime.js";
import { SquarespaceClient, collectionIdFromPath } from "../lib/squarespace.js";
import { checkAgainstSite, eventsOnly, pickLocation, eventLocation, locationText, filterEvents, startOf, flyerName } from "../lib/site.js";
import { WORKFLOW, SETTABLE_STATES, workflowName } from "../lib/item.js";

const HOST_ID = "sq-event-importer-host";
const STORE_KEY = "seasonStore";
const OLD_STORAGE_KEY = "season"; // Before seasons had names. Read once, then left alone.
const PAUSE_BETWEEN_EVENTS_MS = 400;

export function togglePanel() {
  const existing = document.getElementById(HOST_ID);
  if (existing) {
    existing.remove();
    return;
  }
  document.body.appendChild(buildPanel());
}

async function loadStore() {
  try {
    const got = await chrome.storage.local.get([STORE_KEY, OLD_STORAGE_KEY]);
    return normalizeStore({ ...(got[STORE_KEY] ?? {}), season: got[OLD_STORAGE_KEY] });
  } catch {
    return normalizeStore(null);
  }
}

async function saveStore(store) {
  try {
    await chrome.storage.local.set({ [STORE_KEY]: store });
  } catch {
    // Not fatal: the settings just won't be remembered next time.
  }
}

/** The site's time zone once connected, otherwise this computer's. */
function siteZone(state) {
  return state.site?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function todayIn(timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" })
    .formatToParts(new Date());
  const get = (t) => +parts.find((p) => p.type === t).value;
  return { year: get("year"), month: get("month"), day: get("day") };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STYLES = `
  :host { all: initial; }
  .panel {
    position: fixed; top: 16px; right: 16px; z-index: 2147483647;
    width: min(880px, calc(100vw - 32px)); max-height: calc(100vh - 32px);
    display: flex; flex-direction: column;
    background: #fff; color: #1a1a1a; border: 1px solid #ccc; border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0,0,0,.2);
    font: 14px/1.4 system-ui, sans-serif;
  }
  header { display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; border-bottom: 1px solid #eee; }
  h1 { font-size: 16px; margin: 0; }
  button { font: inherit; cursor: pointer; }
  button:disabled { cursor: default; }
  .close { border: none; background: none; font-size: 20px; line-height: 1; }
  .body { padding: 16px; overflow: auto; }
  .box { padding: 8px 12px; border-radius: 6px; margin: 8px 0; }
  .info { background: #f3f6fa; border: 1px solid #c9d6e8; }
  .warn { background: #fff4e5; border: 1px solid #f0c27b; }
  .error { background: #fdecea; border: 1px solid #f5a8a0; }
  .ok { background: #eaf6ec; border: 1px solid #9fd3a8; }
  .box ul { margin: 4px 0 0; padding-left: 20px; }
  details { border: 1px solid #ddd; border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; }
  summary { cursor: pointer; font-weight: 600; }
  .field { display: block; margin: 10px 0; }
  .field span { display: block; font-weight: 600; margin-bottom: 2px; }
  .field small { display: block; color: #666; margin-bottom: 4px; }
  .field input, .field textarea { width: 100%; box-sizing: border-box; font: inherit; padding: 4px 6px; }
  .field textarea { min-height: 72px; resize: vertical; }
  .inputs { margin: 8px 0; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; }
  .inputs small { grid-column: 1 / -1; color: #555; }
  .inputs label { display: block; font-weight: 600; }
  .status-update { color: #1a56b3; font-weight: 600; }
  .thumb { max-width: 240px; max-height: 160px; display: block; margin-bottom: 8px; border: 1px solid #ddd; }
  .actions button.secondary { background: #fff; color: #1a56b3; }
  .actions button.secondary:disabled { background: #f3f3f3; color: #999; border-color: #ccc; }
  .inputs input { display: block; margin-top: 4px; font-weight: normal; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #ddd; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f6f6f6; }
  tbody tr { cursor: pointer; }
  tbody tr:hover { background: #f4f8ff; }
  tbody tr.selected { background: #e3edff; }
  .status-error { color: #b3261e; font-weight: 600; }
  .status-warn { color: #8a5a00; }
  .status-ok { color: #1e7b34; }
  .status-skip { color: #555; font-style: italic; }
  .status-busy { color: #1a56b3; }
  .detail { border: 1px solid #ddd; border-radius: 6px; padding: 12px; margin-top: 12px; }
  .detail dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 0 0 12px; }
  .detail dt { font-weight: 600; }
  .caption { border-top: 1px dashed #ccc; padding-top: 8px; }
  .caption h3, .caption h4 { text-align: center; margin: 8px 0; }
  .caption p { margin: 6px 0; }
  .actions { margin-top: 16px; display: flex; align-items: center; gap: 12px; }
  .actions button { padding: 6px 14px; border-radius: 6px; border: 1px solid #1a56b3;
    background: #1a56b3; color: #fff; font-weight: 600; }
  .actions button:disabled { background: #c9d0da; border-color: #c9d0da; }
  .actions small { color: #666; }
  .season-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 10px 0 4px; }
  .season-bar select, .status-change select { font: inherit; padding: 3px 4px; }
  .season-bar button { padding: 3px 10px; border: 1px solid #bbb; border-radius: 4px; background: #fff; }
  .season-bar small { flex-basis: 100%; color: #666; }
  .status-change { border-top: 1px solid #eee; padding-top: 12px; }
  .status-change label { font-weight: 600; }
  .status-changed { color: #1e7b34; font-weight: 600; }
  td.pick, th.pick { width: 1%; text-align: center; }
  #all-events { margin-top: 0; }
  .filters { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
  .filters select, .filters input { font: inherit; padding: 3px 4px; }
  .filters input { flex: 1; min-width: 140px; }
  .scroll { max-height: 340px; overflow: auto; border: 1px solid #ddd; }
  .scroll table { border: none; }
  .scroll thead th { position: sticky; top: 0; }
  .muted { color: #666; }
`;

function buildPanel() {
  const host = document.createElement("div");
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: "open" });

  root.innerHTML = `
    <style>${STYLES}</style>
    <div class="panel" role="dialog" aria-label="Event importer">
      <header>
        <h1>Event importer</h1>
        <button class="close" title="Close" aria-label="Close">&times;</button>
      </header>
      <div class="body">
        <div id="site"></div>
        <details id="all-events" hidden>
          <summary id="all-summary">All events on this page</summary>
          <div class="filters">
            <select id="f-when" aria-label="Dates">
              <option value="upcoming">Upcoming and current</option>
              <option value="past">Past</option>
              <option value="all">All dates</option>
            </select>
            <select id="f-status" aria-label="Status">
              <option value="">Any status</option>
              <option value="4">Draft</option>
              <option value="3">Needs review</option>
              <option value="1">Published</option>
              <option value="2">Scheduled</option>
            </select>
            <input id="f-text" type="search" placeholder="Search titles" aria-label="Search titles">
          </div>
          <div id="all-list"></div>
        </details>
        <details id="season">
          <summary id="season-summary">Season settings</summary>
          <div class="season-bar">
            <label for="season-pick">Season</label>
            <select id="season-pick"></select>
            <button id="season-copy" title="Start a new season from this one">Copy...</button>
            <button id="season-rename">Rename...</button>
            <button id="season-delete">Delete</button>
            <button id="season-export" title="Save all seasons to a file">Export</button>
            <button id="season-import" title="Add seasons from an exported file">Import...</button>
            <input type="file" id="season-file" accept=".json,application/json" hidden>
            <small>Changes are saved as you type. For a new year, copy last year's season and change what's different.</small>
          </div>
          <div id="season-fields"></div>
        </details>
        <div class="inputs">
          <label>Spreadsheet (CSV)<input type="file" accept=".csv,text/csv" id="csv"></label>
          <label>Flyer images (optional)<input type="file" accept="image/*" multiple id="images"></label>
          <small id="image-summary"></small>
        </div>
        <div id="result"></div>
      </div>
    </div>
  `;

  const $ = (id) => root.getElementById(id);
  const state = {
    store: normalizeStore(null),
    season: withDefaults(null),
    statusSkip: new Set(), // ids of events on the site left out of the spreadsheet's status change
    statusTarget: { sheet: WORKFLOW.PUBLISHED, all: WORKFLOW.PUBLISHED },
    statusResults: new Map(), // event id -> result of a status change, shown in both lists
    allTicked: new Set(), // ids ticked in the full list
    filter: { when: "upcoming", status: null, text: "" },
    csv: null,
    images: null,
    selectedLine: null,
    site: { status: "loading" },
    run: { running: false, results: new Map() },
    client: new SquarespaceClient({
      origin: location.origin,
      cookies: () => document.cookie,
      fetch: (...args) => fetch(...args),
    }),
  };

  root.querySelector(".close").addEventListener("click", () => {
    if (state.run.running && !confirm("The importer is still working. Close anyway? The remaining events won't be done.")) return;
    state.run.cancelled = true;
    host.remove();
  });

  const showSeason = () => {
    state.season = state.store.seasons[state.store.current];
    renderSeasonBar(root, state);
    renderSeasonFields(root, state, () => {
      state.store = updateCurrent(state.store, state.season);
      saveStore(state.store);
      render(root, state);
    });
    render(root, state);
  };
  const changeStore = (store) => {
    state.store = store;
    saveStore(store);
    showSeason();
  };

  loadStore().then((store) => {
    state.store = store;
    showSeason();
    if (!state.season.earlyBirdDeadline) $("season").open = true;
  });

  $("f-when").addEventListener("change", (e) => { state.filter.when = e.target.value; renderAllEvents(root, state); });
  $("f-status").addEventListener("change", (e) => {
    state.filter.status = e.target.value ? Number(e.target.value) : null;
    renderAllEvents(root, state);
  });
  $("f-text").addEventListener("input", (e) => { state.filter.text = e.target.value; renderAllEvents(root, state); });

  $("season-pick").addEventListener("change", (e) => changeStore({ ...state.store, current: e.target.value }));
  $("season-copy").addEventListener("click", () => {
    const name = askName(state.store, `Name for the copy of "${state.store.current}", like Summer 2027:`, "");
    if (name) changeStore(addSeason(state.store, name, state.season));
  });
  $("season-rename").addEventListener("click", () => {
    const from = state.store.current;
    const name = askName(state.store, `New name for "${from}":`, from, from);
    if (name && name !== from) changeStore(renameSeason(state.store, from, name));
  });
  $("season-delete").addEventListener("click", () => {
    if (!confirm(`Delete the season "${state.store.current}"? Its settings can't be brought back unless they were exported.`)) return;
    changeStore(deleteSeason(state.store, state.store.current));
  });
  $("season-export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(exportSeasons(state.store), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `event-manager-seasons-${new Date().toISOString().slice(0, 10)}.json`;
    root.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  });
  $("season-import").addEventListener("click", () => $("season-file").click());
  $("season-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const { store, added } = importSeasons(state.store, JSON.parse(await file.text()));
      changeStore(store);
      alert(`Added: ${added.join(", ")}. Pick one from the Season list.`);
    } catch (err) {
      alert(err instanceof SyntaxError ? "That file isn't a season backup from the event manager." : err.message);
    }
  });

  connectSite(state).then(() => render(root, state));

  $("csv").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    state.selectedLine = null;
    state.run.results = new Map();
    state.statusSkip = new Set();
    if (!file) {
      state.csv = null;
    } else {
      try {
        state.csv = { name: file.name, ...toRecords(parseCsv(await file.text())) };
      } catch (err) {
        state.csv = { name: file.name, error: err.message };
      }
    }
    render(root, state);
  });

  $("images").addEventListener("change", (e) => {
    const files = [...(e.target.files ?? [])];
    state.images = files.length ? new Map(files.map((f) => [f.name.toLowerCase(), f])) : null;
    render(root, state);
  });

  render(root, state);
  return host;
}

/** Finds the Events page this editor tab is on, its existing events and a location to copy. */
async function connectSite(state) {
  const collectionId = collectionIdFromPath(location.pathname);
  if (!collectionId) {
    state.site = {
      status: "unavailable",
      message: "To create drafts, open the Events page in the editor (Pages, then Events), then click the extension button again. The preview works anywhere.",
    };
    return;
  }
  try {
    const settings = await state.client.getCollectionSettings(collectionId);
    if (!String(settings?.typeName ?? "").startsWith("events")) {
      state.site = {
        status: "unavailable",
        message: `The page open in the editor ("${settings?.title ?? "unknown"}") isn't an events page. Open the Events page, then click the extension button again.`,
      };
      return;
    }
    const info = await state.client.getSiteInfo(settings.fullUrl || "/");
    const existing = eventsOnly(await state.client.listItems(collectionId));
    state.site = {
      status: "ready",
      collectionId,
      websiteId: settings.websiteId,
      authorId: info.accountId,
      timeZone: info.timeZone,
      title: settings.title,
      existing,
      location: pickLocation(existing),
    };
  } catch (err) {
    state.site = { status: "error", message: err.message };
  }
}

/** Asks for a season name until it's usable or cancelled. */
function askName(store, question, initial, except = null) {
  let name = initial;
  for (;;) {
    name = prompt(question, name);
    if (name === null) return null;
    const problem = seasonNameProblem(store, name, { except });
    if (!problem) return name.trim();
    alert(problem);
  }
}

function renderSeasonBar(root, state) {
  const pick = root.getElementById("season-pick");
  pick.replaceChildren(...seasonNames(state.store).map((n) => new Option(n, n, false, n === state.store.current)));
  root.getElementById("season-summary").textContent = `Season settings: ${state.store.current}`;
  root.getElementById("season-delete").disabled = Object.keys(state.store.seasons).length <= 1;
}

function renderSeasonFields(root, state, onChange) {
  const container = root.getElementById("season-fields");
  container.replaceChildren();
  for (const f of SEASON_FIELDS) {
    const label = document.createElement("label");
    label.className = "field";
    const title = document.createElement("span");
    title.textContent = f.label;
    label.append(title);
    if (f.hint) {
      const hint = document.createElement("small");
      hint.textContent = f.hint;
      label.append(hint);
    }
    const input = document.createElement(f.multiline ? "textarea" : "input");
    input.value = state.season[f.key];
    input.dataset.seasonField = f.key;
    input.addEventListener("input", () => {
      state.season = { ...state.season, [f.key]: input.value };
      onChange();
    });
    label.append(input);
    container.append(label);
  }
}

function box(kind, heading, items = []) {
  const div = document.createElement("div");
  div.className = `box ${kind}`;
  const strong = document.createElement("strong");
  strong.textContent = heading;
  div.append(strong);
  if (items.length) {
    const ul = document.createElement("ul");
    for (const item of items) {
      const li = document.createElement("li");
      li.textContent = item;
      ul.append(li);
    }
    div.append(ul);
  }
  return div;
}

function renderSite(root, state) {
  const out = root.getElementById("site");
  out.replaceChildren();
  const s = state.site;
  if (s.status === "loading") {
    out.append(box("info", "Checking the Events page..."));
  } else if (s.status === "unavailable") {
    out.append(box("warn", s.message));
  } else if (s.status === "error") {
    out.append(box("error", `Couldn't read the Events page. Drafts can't be created. ${s.message}`));
  } else {
    const loc = eventLocation(state.season, s.location);
    const items = [
      `${s.existing.length} events are already on the page. Rows matching one of them by title and start day are compared with it instead of created.`,
      !loc
        ? "No existing event has a location to copy, so new drafts will have none. Set one in the season settings."
        : loc.source === "season"
          ? `New drafts get the location from the season settings: ${locationText(loc.location)}.`
          : `New drafts get this location, copied from "${loc.from.title}": ${locationText(loc.location)}. To use a different one, set it in the season settings.`,
      s.timeZone
        ? `Times are in the site's time zone, ${s.timeZone}.`
        : `Couldn't read the site's time zone, so times are in this computer's, ${siteZone(state)}.`,
    ];
    out.append(box("info", `Connected to the "${s.title}" page.`, items));
  }
}

function rowStatus(p, state) {
  const result = state.run.results.get(p.line);
  if (result?.kind === "busy") return result;
  const changed = p.existing ? state.statusResults.get(p.existing.id) : null;
  if (changed) return changed;
  if (result) return result;
  if (p.errors.length) return { kind: "error", text: p.errors.join(" ") };
  if (p.existing && p.changes.length) return { kind: "update", text: `${workflowName(p.existing.workflowState)} on the site. Will update: ${p.changes.join(", ")}.` };
  if (p.existing) return { kind: "skip", text: `${workflowName(p.existing.workflowState)} on the site, no changes.` };
  if (p.warnings.length) return { kind: "warn", text: p.warnings.join(" ") };
  return { kind: "ok", text: p.image ? "Ready, with flyer" : "Ready" };
}

const isDone = (p, state) => ["ok", "updated"].includes(state.run.results.get(p.line)?.kind);

function computePlans(state) {
  const seasonCheck = checkSeason(state.season);
  const timeZone = siteZone(state);
  const plans = planAll(state.csv.records, { ...state.season, timeZone }, {
    deadline: seasonCheck.deadline,
    imageNames: state.images ? new Set(state.images.keys()) : null,
    today: todayIn(timeZone),
  });
  if (state.site.status === "ready") {
    checkAgainstSite(plans, state.site.existing, timeZone, state.season.fullTitleSuffix);
  }
  return { plans, seasonCheck };
}

function renderImageSummary(root, state, plans) {
  const out = root.getElementById("image-summary");
  if (!state.images) {
    out.textContent = "Each flyer is used in the page and as the featured image. An event already on the site gets a new flyer when the Image column names a different file.";
    return;
  }
  const used = new Set((plans ?? []).map((p) => p.image.toLowerCase()).filter(Boolean));
  const unused = [...state.images.values()].filter((f) => plans && !used.has(f.name.toLowerCase())).map((f) => f.name);
  out.textContent = `${state.images.size} image${state.images.size === 1 ? "" : "s"} chosen.` +
    (unused.length ? ` Not used by any row: ${unused.join(", ")}.` : "");
}

function render(root, state) {
  renderSite(root, state);
  renderAllEvents(root, state);
  for (const el of root.querySelectorAll("#csv, #images, [data-season-field], .season-bar select, .season-bar button")) {
    el.disabled = state.run.running || (el.id === "season-delete" && Object.keys(state.store.seasons).length <= 1);
  }

  const out = root.getElementById("result");
  out.replaceChildren();
  renderImageSummary(root, state, null);
  if (!state.csv) return;

  if (state.csv.error) {
    out.append(box("error", `Couldn't read ${state.csv.name}: ${state.csv.error}`));
    return;
  }

  const { missing, unknown } = checkHeaders(state.csv.headers);
  if (missing.length) {
    out.append(box("error", "The spreadsheet is missing required columns:", missing));
    return;
  }
  if (unknown.length) {
    out.append(box("warn", "These columns aren't used and will be ignored:", unknown));
  }

  const { plans, seasonCheck } = computePlans(state);
  renderImageSummary(root, state, plans);
  if (seasonCheck.errors.length) {
    out.append(box("error", "Fix the season settings first:", seasonCheck.errors));
  }

  const bad = plans.filter((p) => p.errors.length).length;
  // Rows done in this session stay excluded even if the refreshed list hasn't caught up.
  const toCreate = plans.filter((p) => !p.existing && !p.errors.length && !isDone(p, state));
  const toUpdate = plans.filter((p) => p.existing && p.changes.length && !p.errors.length && !isDone(p, state));
  const unchanged = plans.filter((p) => p.existing && !p.changes.length).length;
  const summary = `${plans.length} event${plans.length === 1 ? "" : "s"} in the spreadsheet: ` +
    `${toCreate.length} new, ${toUpdate.length} to update, ${unchanged} unchanged` +
    (bad ? `, ${bad} need${bad === 1 ? "s" : ""} fixing` : "") +
    ". Click a row to see the event.";
  out.append(box(bad || seasonCheck.errors.length ? "error" : "ok", summary));

  const table = document.createElement("table");
  const onSite = state.site.status === "ready" ? plans.filter((p) => p.existing) : [];
  table.innerHTML = '<thead><tr><th class="pick"></th><th>Line</th><th>Title</th><th>When</th><th>Flyer</th><th>Status</th></tr></thead>';
  if (onSite.length) {
    const all = document.createElement("input");
    all.type = "checkbox";
    all.title = "Tick or untick every event on the site, for the status change below";
    all.checked = onSite.every((p) => !state.statusSkip.has(p.existing.id));
    all.disabled = state.run.running;
    all.addEventListener("change", () => {
      state.statusSkip = all.checked ? new Set() : new Set(onSite.map((p) => p.existing.id));
      render(root, state);
    });
    table.querySelector("th.pick").append(all);
  }
  const tbody = table.createTBody();
  for (const p of plans) {
    const tr = tbody.insertRow();
    if (p.line === state.selectedLine) tr.className = "selected";
    const pick = tr.insertCell();
    pick.className = "pick";
    if (onSite.includes(p)) {
      const tick = document.createElement("input");
      tick.type = "checkbox";
      tick.title = "Include in the status change below";
      tick.checked = !state.statusSkip.has(p.existing.id);
      tick.disabled = state.run.running;
      tick.addEventListener("click", (e) => e.stopPropagation());
      tick.addEventListener("change", () => {
        if (tick.checked) state.statusSkip.delete(p.existing.id);
        else state.statusSkip.add(p.existing.id);
        render(root, state);
      });
      pick.append(tick);
    }
    tr.insertCell().textContent = String(p.line);
    tr.insertCell().textContent = p.title || "(no title)";
    tr.insertCell().textContent = whenText(p);
    tr.insertCell().textContent = p.image && (!p.existing || p.changes.includes("flyer")) ? p.image : "-";
    const status = tr.insertCell();
    const st = rowStatus(p, state);
    status.className = `status-${st.kind}`;
    status.textContent = st.text;
    if (st.url) {
      status.append(" ");
      const a = document.createElement("a");
      a.href = st.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "View";
      a.addEventListener("click", (e) => e.stopPropagation());
      status.append(a);
    }
    tr.addEventListener("click", () => {
      state.selectedLine = p.line;
      render(root, state);
    });
  }
  out.append(table);

  const selected = plans.find((p) => p.line === state.selectedLine);
  if (selected) out.append(renderDetail(selected, state));

  const blockers = [];
  if (state.site.status !== "ready") blockers.push("the Events page isn't connected");
  if (seasonCheck.errors.length) blockers.push("the season settings need fixing");
  if (bad) blockers.push("some rows need fixing");

  const actions = document.createElement("div");
  actions.className = "actions";
  const create = document.createElement("button");
  create.textContent = `Create ${toCreate.length} draft${toCreate.length === 1 ? "" : "s"}`;
  create.disabled = state.run.running || blockers.length > 0 || !toCreate.length;
  create.addEventListener("click", () => createDrafts(root, state, toCreate));
  const update = document.createElement("button");
  update.className = "secondary";
  update.textContent = `Update ${toUpdate.length} event${toUpdate.length === 1 ? "" : "s"}`;
  update.disabled = state.run.running || blockers.length > 0 || !toUpdate.length;
  update.addEventListener("click", () => updateEvents(root, state, toUpdate));
  const note = document.createElement("small");
  if (state.run.running) note.textContent = "Working...";
  else if (blockers.length) note.textContent = `Can't continue yet: ${blockers.join(", ")}.`;
  else note.textContent = "New events are created as drafts. Updates change existing events, including published ones, right away.";
  actions.append(create, update, note);
  out.append(actions);

  if (onSite.length) out.append(renderStatusChange(root, state, onSite));
}

function renderStatusChange(root, state, onSite) {
  // The same event can appear on two rows; count it once.
  const byId = new Map();
  for (const p of onSite) if (!state.statusSkip.has(p.existing.id)) byId.set(p.existing.id, p.existing);
  return statusControls(root, state, {
    which: "sheet",
    picked: [...byId.values()],
    note: (picked, already, name) => picked
      ? `${picked} of ${onSite.length} events on the site ticked` + (already ? `, ${already} already ${name}.` : ".")
      : "Tick events in the first column to change their status.",
  });
}

/** "Set ticked events to [status] [Change N events]" for either list. */
function statusControls(root, state, { which, picked, note }) {
  const target = state.statusTarget[which];
  const toChange = picked.filter((item) => item.workflowState !== target);

  const div = document.createElement("div");
  div.className = "actions status-change";
  const label = document.createElement("label");
  label.textContent = "Set ticked events to ";
  const select = document.createElement("select");
  for (const st of SETTABLE_STATES) select.append(new Option(workflowName(st), String(st), false, st === target));
  select.disabled = state.run.running;
  select.addEventListener("change", () => {
    state.statusTarget[which] = Number(select.value);
    render(root, state);
  });
  label.append(select);

  const button = document.createElement("button");
  button.className = "secondary";
  button.textContent = `Change ${toChange.length} event${toChange.length === 1 ? "" : "s"}`;
  button.disabled = state.run.running || !toChange.length;
  button.addEventListener("click", () => changeStatus(root, state, toChange, target));

  const small = document.createElement("small");
  small.textContent = state.run.running ? "Working..." : note(picked.length, picked.length - toChange.length, workflowName(target).toLowerCase());
  div.append(label, button, small);
  return div;
}

function formatStart(item, timeZone) {
  const start = startOf(item);
  if (start === null) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(start));
}

/** Every event on the page, for changing status without a spreadsheet. */
function renderAllEvents(root, state) {
  const details = root.getElementById("all-events");
  if (state.site.status !== "ready") {
    details.hidden = true;
    return;
  }
  details.hidden = false;
  const all = state.site.existing;
  root.getElementById("all-summary").textContent = `All events on this page (${all.length})`;
  for (const el of root.querySelectorAll(".filters select, .filters input")) el.disabled = state.run.running;

  const shown = filterEvents(all, { ...state.filter, now: Date.now() });
  const list = root.getElementById("all-list");
  list.replaceChildren();
  if (!shown.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "No events match.";
    list.append(p);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "scroll";
  const table = document.createElement("table");
  table.innerHTML = '<thead><tr><th class="pick"></th><th>Title</th><th>Starts</th><th>Status</th></tr></thead>';
  const allBox = document.createElement("input");
  allBox.type = "checkbox";
  allBox.title = "Tick or untick every event shown";
  allBox.checked = shown.every((i) => state.allTicked.has(i.id));
  allBox.disabled = state.run.running;
  allBox.addEventListener("change", () => {
    for (const i of shown) {
      if (allBox.checked) state.allTicked.add(i.id);
      else state.allTicked.delete(i.id);
    }
    renderAllEvents(root, state);
  });
  table.querySelector("th.pick").append(allBox);

  const tbody = table.createTBody();
  for (const item of shown) {
    const tr = tbody.insertRow();
    const pick = tr.insertCell();
    pick.className = "pick";
    const tick = document.createElement("input");
    tick.type = "checkbox";
    tick.checked = state.allTicked.has(item.id);
    tick.disabled = state.run.running;
    tick.addEventListener("click", (e) => e.stopPropagation());
    tick.addEventListener("change", () => {
      if (tick.checked) state.allTicked.add(item.id);
      else state.allTicked.delete(item.id);
      renderAllEvents(root, state);
    });
    pick.append(tick);
    tr.addEventListener("click", () => { if (!state.run.running) tick.click(); });

    const title = tr.insertCell();
    title.textContent = item.title || "(no title)";
    if (item.fullUrl) {
      title.append(" ");
      const a = document.createElement("a");
      a.href = location.origin + item.fullUrl;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "View";
      a.addEventListener("click", (e) => e.stopPropagation());
      title.append(a);
    }
    tr.insertCell().textContent = formatStart(item, siteZone(state));
    const status = tr.insertCell();
    const changed = state.statusResults.get(item.id);
    status.className = changed ? `status-${changed.kind}` : "";
    status.textContent = changed ? changed.text : workflowName(item.workflowState);
  }
  wrap.append(table);
  list.append(wrap);

  list.append(statusControls(root, state, {
    which: "all",
    picked: shown.filter((i) => state.allTicked.has(i.id)),
    note: (picked, already, name) => picked
      ? `${picked} of ${shown.length} shown ticked` + (already ? `, ${already} already ${name}.` : ".")
      : "Tick events to change their status. Clicking a row ticks it.",
  }));
}

/** Sets each of `items` (events on the site) to `target`, one at a time. */
async function changeStatus(root, state, items, target) {
  const n = items.length;
  const name = workflowName(target).toLowerCase();
  const MAX_LISTED = 15;
  const lines = items.slice(0, MAX_LISTED).map((i) => `- ${i.title} (now ${workflowName(i.workflowState).toLowerCase()})`).join("\n") +
    (n > MAX_LISTED ? `\n...and ${n - MAX_LISTED} more` : "");
  const livePulled = items.filter((i) => i.workflowState === WORKFLOW.PUBLISHED).length;
  const effect = target === WORKFLOW.PUBLISHED
    ? "They'll show on the live site right away."
    : livePulled
      ? `${livePulled} of them ${livePulled === 1 ? "is" : "are"} published now and will be taken off the live site.`
      : "None of them are published now.";
  if (!confirm(`Set ${n} event${n === 1 ? "" : "s"} on ${location.hostname} to ${name}?\n\n${lines}\n\n${effect}`)) return;

  const { collectionId } = state.site;
  state.run.running = true;
  state.run.cancelled = false;
  for (const item of items) {
    if (state.run.cancelled) break;
    state.statusResults.set(item.id, { kind: "busy", text: "Changing status..." });
    render(root, state);
    try {
      const saved = await state.client.setEventStatus({ collectionId, itemId: item.id, state: target });
      const url = saved?.fullUrl ?? item.fullUrl;
      state.statusResults.set(item.id, { kind: "changed", text: `Now ${name}.`, url: url ? location.origin + url : undefined });
    } catch (err) {
      state.statusResults.set(item.id, { kind: "error", text: `Status change failed: ${err.message}` });
    }
    render(root, state);
    await sleep(PAUSE_BETWEEN_EVENTS_MS);
  }
  await refreshExisting(state);
  state.run.running = false;
  render(root, state);
}

async function updateEvents(root, state, plans) {
  const n = plans.length;
  const published = plans.filter((p) => p.existing?.workflowState === 1).length;
  const lines = plans.map((p) => `- ${p.existing.title}: ${p.changes.join(", ")}`).join("\n");
  const ok = confirm(
    `Update ${n} event${n === 1 ? "" : "s"} on ${location.hostname}?\n\n${lines}\n\n` +
    (published ? `${published} of them ${published === 1 ? "is" : "are"} published, so the change shows on the live site right away.` : "None of them are published."),
  );
  if (!ok) return;

  const { collectionId, websiteId } = state.site;
  state.run.running = true;
  state.run.cancelled = false;
  for (const p of plans) {
    if (state.run.cancelled) break;
    state.statusResults.delete(p.existing.id);
    const flyer = p.changes.includes("flyer");
    state.run.results.set(p.line, { kind: "busy", text: flyer ? "Updating and uploading the flyer..." : "Updating..." });
    render(root, state);
    try {
      const imageFile = flyer ? state.images?.get(p.image.toLowerCase()) ?? null : null;
      const saved = await state.client.updateExistingEvent({ collectionId, websiteId, itemId: p.existing.id, plan: p, changes: p.changes, imageFile });
      state.run.results.set(p.line, {
        kind: "updated",
        text: `Updated: ${p.changes.join(", ")}.`,
        url: (saved?.fullUrl ?? p.existing.fullUrl) ? location.origin + (saved?.fullUrl ?? p.existing.fullUrl) : undefined,
      });
    } catch (err) {
      state.run.results.set(p.line, { kind: "error", text: `Failed: ${err.message}` });
    }
    render(root, state);
    await sleep(PAUSE_BETWEEN_EVENTS_MS);
  }
  await refreshExisting(state);
  state.run.running = false;
  render(root, state);
}

async function refreshExisting(state) {
  try {
    state.site.existing = eventsOnly(await state.client.listItems(state.site.collectionId));
  } catch {
    // The results above still stand; a stale list only affects a second run.
  }
}

async function createDrafts(root, state, plans) {
  const n = plans.length;
  const ok = confirm(
    `Create ${n} draft event${n === 1 ? "" : "s"} on ${location.hostname}?\n\n` +
    "They won't be published. You can review and delete them in the editor.",
  );
  if (!ok) return;

  const { collectionId, websiteId, authorId } = state.site;
  const locationToCopy = eventLocation(state.season, state.site.location)?.location ?? null;
  state.run.running = true;
  state.run.cancelled = false;

  for (const p of plans) {
    if (state.run.cancelled) break;
    state.run.results.set(p.line, { kind: "busy", text: "Creating..." });
    render(root, state);
    try {
      const imageFile = p.image ? state.images?.get(p.image.toLowerCase()) ?? null : null;
      if (imageFile) {
        state.run.results.set(p.line, { kind: "busy", text: "Creating and uploading the flyer..." });
        render(root, state);
      }
      const saved = await state.client.createDraftEvent({ collectionId, websiteId, authorId, location: locationToCopy, plan: p, imageFile });
      state.run.results.set(p.line, {
        kind: "ok",
        text: "Draft created.",
        url: saved?.fullUrl ? location.origin + saved.fullUrl : undefined,
      });
    } catch (err) {
      state.run.results.set(p.line, { kind: "error", text: `Failed: ${err.message}` });
    }
    render(root, state);
    await sleep(PAUSE_BETWEEN_EVENTS_MS);
  }

  // Refresh the list of existing events so running the import again skips these.
  await refreshExisting(state);
  state.run.running = false;
  render(root, state);
}

function whenText(p) {
  if (!p.startDate || !p.startTime || !p.endTime) return "";
  const days = formatIsoDate(p.startDate) + (p.endDate && formatIsoDate(p.endDate) !== formatIsoDate(p.startDate) ? ` to ${formatIsoDate(p.endDate)}` : "");
  return `${days}, ${formatTime(p.startTime)}-${formatTime(p.endTime)}`;
}

function formatInZone(ms, timeZone) {
  if (ms === null) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(ms));
}

function renderDetail(p, state) {
  const timeZone = siteZone(state);
  const div = document.createElement("div");
  div.className = "detail";
  const file = p.image && (!p.existing || p.changes.includes("flyer")) ? state.images?.get(p.image.toLowerCase()) : null;
  if (file) {
    const img = document.createElement("img");
    img.className = "thumb";
    img.alt = `Flyer: ${file.name}`;
    img.src = URL.createObjectURL(file);
    img.addEventListener("load", () => URL.revokeObjectURL(img.src), { once: true });
    div.append(img);
  }
  const dl = document.createElement("dl");
  const rows = [
    ["Title", p.title],
    ["Web address", p.slug ? `/events/${p.slug}` : ""],
    ["Starts", formatInZone(p.start, timeZone)],
    ["Ends", formatInZone(p.end, timeZone)],
    ["Tags", p.tags.join(", ")],
    ["Categories", p.categories.join(", ")],
  ];
  if (p.existing) {
    rows.push(["On the site", `${p.existing.title} (${p.existing.fullUrl ?? p.existing.urlId}), ${workflowName(p.existing.workflowState).toLowerCase()}`]);
    rows.push(["Will change", p.changes.length ? p.changes.join(", ") : "nothing"]);
    const current = flyerName(p.existing);
    if (p.changes.includes("flyer")) rows.push(["Flyer", `${p.image} replaces ${current ?? "no flyer"}`]);
    else rows.push(["Flyer", current ? `${current}${p.image ? ", same as the spreadsheet" : ""}` : "none"]);
  } else {
    rows.push(["Flyer", p.image || "none"]);
  }
  for (const [k, v] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v || "-";
    dl.append(dt, dd);
  }
  div.append(dl);
  if (p.errors.length) div.append(box("error", "Needs fixing:", p.errors));
  if (p.warnings.length) div.append(box("warn", "Warnings:", p.warnings));

  const caption = document.createElement("div");
  caption.className = "caption";
  // captionHtml is built by template.js, which escapes every spreadsheet value.
  caption.innerHTML = p.captionHtml;
  div.append(caption);
  return div;
}
