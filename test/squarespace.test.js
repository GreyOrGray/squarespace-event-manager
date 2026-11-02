import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { textBlock, imageBlock, bodyLayout, createBody, saveBody, newBlockId, updatedItem, findTextBlocks, UpdateRefused, WORKFLOW_DRAFT, WORKFLOW, withWorkflowState, workflowName, findImageBlocks } from "../extension/lib/item.js";
import { SquarespaceClient, readCrumb, collectionIdFromPath } from "../extension/lib/squarespace.js";
import { checkAgainstSite, pickLocation, dayInZone, eventsOnly, diffEvent, flyerName, sameFileName } from "../extension/lib/site.js";

const TZ = "America/New_York";
const CID = "0000000000000000000000c1";
const WID = "0000000000000000000000a1";
const LOCATION = { addressTitle: "Example Art Studio", addressLine1: "100 Example Street", addressLine2: "Springfield, ST, 00000", addressCountry: "United States", mapLat: 40.5, mapLng: -100, mapZoom: 12, markerLat: 40.5, markerLng: -100 };

function plan(fields = {}) {
  return {
    line: 2, title: "TEST - Camp", baseTitle: "TEST - Camp", slug: "test-camp-2027",
    start: Date.UTC(2027, 5, 7, 15), end: Date.UTC(2027, 5, 11, 18),
    captionHtml: "<p>Hello</p>", excerptHtml: "<p>Hello</p>",
    tags: [], categories: [], errors: [], warnings: [], ...fields,
  };
}

// ---- item.js

test("textBlock matches the block the editor saved, apart from content and id", async () => {
  const recorded = JSON.parse(await readFile(new URL("./fixtures/text-block.recorded.json", import.meta.url), "utf8"));
  const ours = textBlock(recorded.value.html, recorded.id);
  assert.deepEqual(ours, recorded);
});

test("newBlockId is 20 hex characters", () => {
  assert.match(newBlockId(), /^[0-9a-f]{20}$/);
  assert.notEqual(newBlockId(), newBlockId());
});

test("bodyLayout wraps one text block and points at the item", () => {
  const body = bodyLayout("<p>x</p>", "item1", "b".repeat(20));
  assert.equal(body.layout.parentItemId, "item1");
  assert.equal(body.layout.rows[0].columns[0].blocks[0].value.html, "<p>x</p>");
  assert.equal(body.layout.legacyPromotedLayout, true);
});

test("createBody is a draft with dates and location", () => {
  const b = createBody({ collectionId: CID, websiteId: WID, authorId: "acct1", location: LOCATION, start: 1, end: 2, now: 99 });
  assert.equal(b.authorId, "acct1");
  assert.equal(b.workflowState, WORKFLOW_DRAFT);
  assert.deepEqual(b.structuredContent, { _type: "CalendarEvent", startDate: 1, endDate: 2 });
  assert.equal(b.collectionId, CID);
  assert.equal(b.websiteId, WID);
  assert.deepEqual(b.location, LOCATION);
  assert.equal(b.title, null);
});

test("saveBody fills the created item with the event's content and keeps it a draft", () => {
  const created = { id: "new1", collectionId: CID, workflowState: 4, structuredContent: { _type: "CalendarEvent", startDate: 1, endDate: 2 }, location: LOCATION, commentState: 2 };
  const p = plan();
  const b = saveBody(created, p, { blockId: "c".repeat(20) });
  assert.equal(b.id, "new1");
  assert.equal(b.title, p.title);
  assert.equal(b.urlId, p.slug);
  assert.equal(b.workflowState, WORKFLOW_DRAFT);
  assert.equal(b.startDate, p.start);
  assert.deepEqual(b.structuredContent, { _type: "CalendarEvent", startDate: p.start, endDate: p.end });
  assert.deepEqual(b.excerpt, { html: p.excerptHtml, raw: false });
  assert.equal(b.body.layout.rows[0].columns[0].blocks[0].value.html, p.captionHtml);
  assert.equal(b.commentState, 2);
});

// ---- squarespace.js

test("readCrumb finds the crumb cookie", () => {
  assert.equal(readCrumb("a=1; crumb=AbC%2B12=; b=2"), "AbC+12=");
  assert.equal(readCrumb("a=1"), null);
  assert.equal(readCrumb(""), null);
});

test("collectionIdFromPath", () => {
  assert.equal(collectionIdFromPath(`/config/pages/${CID}`), CID);
  assert.equal(collectionIdFromPath(`/config/pages/${CID}/something`), CID);
  assert.equal(collectionIdFromPath("/config/pages"), null);
  assert.equal(collectionIdFromPath("/events"), null);
});

function mockFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    let json;
    if (typeof init.body === "string") {
      try { json = JSON.parse(init.body); } catch { json = undefined; }
    }
    calls.push({ url, ...init, json });
    const r = responses.shift();
    if (!r) throw new Error("unexpected request " + url);
    return { ok: r.status < 400, status: r.status, text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)) };
  };
  fn.calls = calls;
  return fn;
}

function client(fetchImpl, cookie = "crumb=TOKEN") {
  return new SquarespaceClient({ origin: "https://site.squarespace.com", cookies: () => cookie, fetch: fetchImpl });
}

test("createDraftEvent creates, then saves the whole item, with the security token", async () => {
  const created = { id: "new1", collectionId: CID, fullUrl: "/events/x", workflowState: 4, structuredContent: { _type: "CalendarEvent", startDate: 1, endDate: 2 } };
  const f = mockFetch([{ status: 200, body: created }, { status: 200, body: { ...created, title: "TEST - Camp", fullUrl: "/events/test-camp-2027" } }]);
  const saved = await client(f).createDraftEvent({ collectionId: CID, websiteId: WID, authorId: "acct1", location: LOCATION, plan: plan() });

  assert.equal(saved.fullUrl, "/events/test-camp-2027");
  assert.equal(f.calls.length, 2);
  const [post, put] = f.calls;
  assert.equal(post.method, "POST");
  assert.equal(post.url, `https://site.squarespace.com/api/content/calendars/${CID}/events`);
  assert.equal(post.headers["x-csrf-token"], "TOKEN");
  assert.equal(post.credentials, "include");
  assert.equal(post.json.workflowState, 4);
  assert.equal(post.json.authorId, "acct1");
  assert.equal(put.method, "PUT");
  assert.equal(put.url, `https://site.squarespace.com/api/content/calendars/${CID}/events/new1`);
  assert.equal(put.json.title, "TEST - Camp");
  assert.equal(put.json.workflowState, 4);
});

test("a failed save says an empty draft was left behind", async () => {
  const f = mockFetch([{ status: 200, body: { id: "new1", fullUrl: "/events/abc" } }, { status: 400, body: "bad" }]);
  await assert.rejects(
    client(f).createDraftEvent({ collectionId: CID, websiteId: WID, location: LOCATION, plan: plan() }),
    /draft was created, but saving the event failed.*400.*\(\/events\/abc\)/s,
  );
});

test("writes refuse to run without the security token", async () => {
  const f = mockFetch([]);
  await assert.rejects(client(f, "other=1").createDraftEvent({ collectionId: CID, websiteId: WID, location: LOCATION, plan: plan() }), /security token/);
  assert.equal(f.calls.length, 0);
});

test("logged-out replies explain what to do", async () => {
  const f = mockFetch([{ status: 401, body: "" }]);
  await assert.rejects(client(f).getCollectionSettings(CID), /logged out/);
});

test("getSiteInfo reads the logged-in account and the site's time zone from a page's JSON view", async () => {
  const f = mockFetch([
    { status: 200, body: { authenticatedAccount: { id: "acct1" }, website: { timeZone: "America/New_York" } } },
    { status: 200, body: { authenticatedAccount: { id: "acct1" } } },
    { status: 200, body: {} },
  ]);
  assert.deepEqual(await client(f).getSiteInfo("/events"), { accountId: "acct1", timeZone: "America/New_York" });
  assert.equal(f.calls[0].url, "https://site.squarespace.com/events?format=json");
  assert.equal((await client(f).getSiteInfo("/events")).timeZone, null);
  await assert.rejects(client(f).getSiteInfo("/events"), /which Squarespace account/);
});

test("listItems follows pages", async () => {
  const f = mockFetch([
    { status: 200, body: { results: [{ id: "a" }], hasNextPage: true, nextPageStart: "abc=;x" } },
    { status: 200, body: { results: [{ id: "b" }], hasNextPage: false } },
  ]);
  const items = await client(f).listItems(CID);
  assert.deepEqual(items.map((i) => i.id), ["a", "b"]);
  assert.match(f.calls[1].url, /start=abc%3D%3Bx/);
  assert.equal(f.calls[0].headers["x-csrf-token"], "TOKEN");
});

// ---- site.js

test("dayInZone uses the site's day, not UTC's", () => {
  // 2027-06-07 23:30 in New York is already the 8th in UTC.
  assert.equal(dayInZone(Date.UTC(2027, 5, 8, 3, 30), TZ), "2027-06-07");
});

test("checkAgainstSite marks existing events and address clashes", () => {
  const existing = [
    { recordType: 12, title: "TEST - Camp", urlId: "old", structuredContent: { startDate: Date.UTC(2027, 5, 7, 20) } },
    { recordType: 12, title: "Other", urlId: "taken-2027", structuredContent: { startDate: 0 } },
  ];
  const plans = [plan(), plan({ line: 3, title: "New one", baseTitle: "New one", slug: "taken-2027" }), plan({ line: 4, title: "Fresh", baseTitle: "Fresh", slug: "fresh-2027" })];
  checkAgainstSite(plans, existing, TZ);
  assert.equal(plans[0].existing, existing[0]);
  assert.deepEqual(plans[0].errors, []);
  assert.equal(plans[1].existing, null);
  assert.match(plans[1].errors[0], /already used by "Other"/);
  assert.equal(plans[2].existing, null);
  assert.deepEqual(plans[2].errors, []);
});

test("pickLocation copies from the most recently added event with an address", () => {
  const items = [
    { addedOn: 1, title: "Old", location: { ...LOCATION, addressLine1: "Old Road" } },
    { addedOn: 3, title: "No address", location: { addressLine1: "" } },
    { addedOn: 2, title: "Newer", location: { ...LOCATION, extra: "dropped" } },
  ];
  const picked = pickLocation(items);
  assert.equal(picked.from.title, "Newer");
  assert.deepEqual(picked.location, LOCATION);
  assert.equal(pickLocation([]), null);
});

test("eventsOnly keeps events", () => {
  assert.deepEqual(eventsOnly([{ recordType: 12 }, { recordType: 2 }]), [{ recordType: 12 }]);
});

test("the list fixture shape: the fixture camp is found as existing", async () => {
  const item = JSON.parse(await readFile(new URL("./fixtures/example-event.item.json", import.meta.url), "utf8")).item;
  const p = plan({ title: "Summer Camp: Watercolor **FULL**", baseTitle: "Summer Camp: Watercolor", start: item.startDate - 414, slug: "x" });
  checkAgainstSite([p], [item], TZ);
  assert.equal(p.existing, item);
});

// ---- images

test("imageBlock matches the image block the editor saved, apart from the image and id", async () => {
  const recorded = JSON.parse(await readFile(new URL("./fixtures/image-block.recorded.json", import.meta.url), "utf8"));
  assert.deepEqual(imageBlock(recorded.value.imageId, "", recorded.id), recorded);
});

test("bodyLayout puts the flyer above the text", () => {
  const body = bodyLayout("<p>x</p>", "item1", "t".repeat(20), { imageId: "img1", altText: "Camp", blockId: "i".repeat(20) });
  const blocks = body.layout.rows[0].columns[0].blocks;
  assert.deepEqual(blocks.map((b) => b.definitionName), ["website.components.imageLayout", "website.components.html"]);
  assert.equal(blocks[0].value.imageId, "img1");
  assert.equal(blocks[0].value.altText, "Camp");
});

function mediaResponses() {
  return [
    { status: 200, body: { token: "MEDIA-TOKEN" } },
    { status: 204, body: "" },
    { status: 202, body: { jobId: "job1", checkStatusAfterMs: 1000 } },
    { status: 200, body: [{ id: "job1", isActive: true, isSuccess: false }] },
    { status: 200, body: [{ id: "job1", isActive: false, isSuccess: true, assetId: "asset1" }] },
    { status: 200, body: { media: [{ id: "img1" }] } },
    { status: 200, body: { item: { id: "img1" } } },
  ];
}

const noSleep = async () => {};
function clientWith(f) {
  return new SquarespaceClient({ origin: "https://site.squarespace.com", cookies: () => "crumb=TOKEN", fetch: f, sleep: noSleep, mediaOrigin: "https://media.test" });
}

test("uploadBodyImage follows the editor's media steps", async () => {
  const f = mockFetch(mediaResponses());
  const file = new File(["png"], "flyer.png", { type: "image/png" });
  const id = await clientWith(f).uploadBodyImage(file, { websiteId: WID, altText: "Camp" });
  assert.equal(id, "img1");
  assert.deepEqual(f.calls.map((c) => `${c.method} ${c.url}`), [
    "GET https://site.squarespace.com/api/media/auth/v1/library/authorization",
    "POST https://media.test/user/authorize",
    "POST https://media.test/uploads/image",
    "GET https://media.test/jobs/image/status?job-list=job1",
    "GET https://media.test/jobs/image/status?job-list=job1",
    "POST https://site.squarespace.com/api/uploads/images/asset-reference",
    "POST https://site.squarespace.com/api/commondata/SaveItemField",
  ]);
  assert.equal(f.calls[1].body, "MEDIA-TOKEN");
  assert.equal(f.calls[1].credentials, "include");
  assert.equal(f.calls[2].credentials, "include");
  assert.equal(f.calls[3].credentials, "omit", "the status reply doesn't allow credentials");
  assert.equal(f.calls[1].headers["x-csrf-token"], undefined);
  assert.equal(f.calls[2].headers["x-library-id"], WID);
  assert.ok(f.calls[2].body instanceof FormData);
  assert.equal(f.calls[2].body.get("image").name, "flyer.png");
  assert.equal(String(f.calls[5].body), `assetId=asset1&libraryId=${WID}&recordType=2`);
  assert.equal(f.calls[5].headers["x-csrf-token"], "TOKEN");
});

test("a failed image job is reported", async () => {
  const r = mediaResponses().slice(0, 3);
  r.push({ status: 200, body: [{ id: "job1", isActive: false, isSuccess: false }] });
  await assert.rejects(clientWith(mockFetch(r)).uploadBodyImage(new File(["x"], "bad.png"), { websiteId: WID }), /couldn't process the image bad.png/);
});

test("setFeaturedImage sends SaveMedia and waits for the job", async () => {
  const f = mockFetch([
    { status: 200, body: { media: [{}], job: { id: "j9" } } },
    { status: 200, body: [{ id: "j9", status: 1 }] },
    { status: 200, body: [{ id: "j9", status: 3 }] },
  ]);
  await clientWith(f).setFeaturedImage(new File(["png"], "flyer.png", { type: "image/png" }), { collectionId: CID, itemId: "ev1" });
  const form = f.calls[0].body;
  assert.equal(f.calls[0].url, "https://site.squarespace.com/api/commondata/SaveMedia");
  assert.equal(form.get("replaceItemId"), "ev1");
  assert.equal(form.get("imageDestination"), "content-item-main-image");
  assert.equal(form.get("collectionId"), CID);
  assert.equal(form.get("Filedata").name, "flyer.png");
  assert.equal(f.calls.length, 3);
});

test("createDraftEvent with a flyer: create, upload, save with image block, then featured image", async () => {
  const created = { id: "new1", fullUrl: "/events/x", structuredContent: {} };
  const f = mockFetch([
    { status: 200, body: created },
    ...mediaResponses(),
    { status: 200, body: { ...created, fullUrl: "/events/test-camp-2027" } },
    { status: 200, body: { job: { id: "j1" } } },
    { status: 200, body: [{ status: 3 }] },
  ]);
  const saved = await clientWith(f).createDraftEvent({ collectionId: CID, websiteId: WID, authorId: "a", location: LOCATION, plan: plan(), imageFile: new File(["png"], "flyer.png", { type: "image/png" }) });
  assert.equal(saved.fullUrl, "/events/test-camp-2027");
  const put = f.calls.find((c) => c.method === "PUT");
  const blocks = put.json.body.layout.rows[0].columns[0].blocks;
  assert.equal(blocks[0].value.imageId, "img1");
  assert.equal(blocks[0].value.altText, "TEST - Camp");
  assert.equal(f.calls.at(-2).url, "https://site.squarespace.com/api/commondata/SaveMedia");
  assert.ok(f.calls.indexOf(put) < f.calls.length - 2, "featured image is set after the save");
});

test("a failed flyer upload names the step and the draft to clean up", async () => {
  const f = mockFetch([{ status: 200, body: { id: "new1", fullUrl: "/events/abc" } }, { status: 500, body: "boom" }]);
  await assert.rejects(
    clientWith(f).createDraftEvent({ collectionId: CID, websiteId: WID, authorId: "a", location: LOCATION, plan: plan(), imageFile: new File(["x"], "f.png") }),
    /draft was created, but uploading the flyer failed.*\/events\/abc/s,
  );
});

// ---- updates

function existingItem() {
  return {
    id: "ev1", title: "TEST - Camp", workflowState: 1, urlId: "test-camp-2027",
    startDate: Date.UTC(2027, 5, 7, 15) + 414, endDate: Date.UTC(2027, 5, 11, 18) + 414,
    structuredContent: { _type: "CalendarEvent", startDate: Date.UTC(2027, 5, 7, 15) + 414, endDate: Date.UTC(2027, 5, 11, 18) + 414 },
    excerpt: { html: '<p class="" style="white-space:pre-wrap;" data-rte-preserve-empty="true">Hello</p>', raw: false },
    systemDataId: "featured-image",
    body: { layout: { columns: 12, rows: [{ columns: [{ span: 12, blocks: [imageBlock("img1", "", "i".repeat(20)), textBlock("<p>Hello</p>", "t".repeat(20))] }] }] } },
  };
}

test("diffEvent ignores stray milliseconds and markup differences", () => {
  assert.deepEqual(diffEvent(existingItem(), plan()), []);
  assert.deepEqual(diffEvent(existingItem(), plan({ title: "TEST - Camp **FULL**" })), ["title"]);
  assert.deepEqual(diffEvent(existingItem(), plan({ end: Date.UTC(2027, 5, 11, 19) })), ["dates"]);
  assert.deepEqual(diffEvent(existingItem(), plan({ excerptHtml: "<p>Hello again</p>" })), ["text"]);
});

test("updatedItem changes only what's listed and keeps the flyer and published state", () => {
  const item = existingItem();
  const p = plan({ title: "TEST - Camp **FULL**", captionHtml: "<h3>Full</h3><p>Hello</p>", excerptHtml: "<h3>Full</h3><p>Hello</p>" });
  const out = updatedItem(item, p, ["title", "text"]);
  assert.equal(out.title, "TEST - Camp **FULL**");
  assert.equal(out.workflowState, 1);
  assert.equal(out.systemDataId, "featured-image");
  assert.equal(out.startDate, item.startDate);
  const blocks = out.body.layout.rows[0].columns[0].blocks;
  assert.equal(blocks[0].value.imageId, "img1");
  assert.equal(blocks[1].value.html, p.captionHtml);
  assert.equal(blocks[1].value.source, p.captionHtml);
  assert.equal(out.excerpt.html, p.excerptHtml);
  assert.equal(item.title, "TEST - Camp", "the original isn't modified");
});

test("updatedItem refuses to replace text in events without exactly one text block", async () => {
  const legacy = JSON.parse(await readFile(new URL("./fixtures/example-event.editor.json", import.meta.url), "utf8"));
  assert.equal(findTextBlocks(legacy).length, 0);
  assert.throws(() => updatedItem(legacy, plan(), ["text"]), UpdateRefused);
  const out = updatedItem(legacy, plan({ title: "New title" }), ["title"]);
  assert.equal(out.title, "New title");
});

test("updateExistingEvent fetches the full event and saves it with the change", async () => {
  const f = mockFetch([{ status: 200, body: existingItem() }, { status: 200, body: { ok: true } }]);
  await client(f).updateExistingEvent({ collectionId: CID, itemId: "ev1", plan: plan({ title: "TEST - Camp **FULL**" }), changes: ["title"] });
  assert.equal(f.calls[0].url, `https://site.squarespace.com/api/content/calendars/${CID}/events/ev1`);
  assert.equal(f.calls[1].method, "PUT");
  assert.equal(f.calls[1].json.title, "TEST - Camp **FULL**");
  assert.equal(f.calls[1].json.workflowState, 1);
});

test("checkAgainstSite matches a camp now marked full, by title or by web address", () => {
  const item = { ...existingItem(), recordType: 12 };
  const full = plan({ title: "TEST - Camp **FULL**", baseTitle: "TEST - Camp" });
  checkAgainstSite([full], [item], TZ, " **FULL**");
  assert.equal(full.existing, item);
  assert.deepEqual(full.changes, ["title"]);

  const moved = plan({ start: Date.UTC(2027, 5, 14, 15), end: Date.UTC(2027, 5, 18, 18) });
  checkAgainstSite([moved], [item], TZ, " **FULL**");
  assert.equal(moved.existing, item, "same web address and title, new dates");
  assert.deepEqual(moved.changes, ["dates"]);
});

test("withWorkflowState does what the editor's status picker does", () => {
  const item = { ...existingItem(), workflowState: 4, publishOn: 1700000000000 };
  const now = Date.UTC(2026, 9, 30, 18, 5, 42, 123);
  const pub = withWorkflowState(item, WORKFLOW.PUBLISHED, now);
  assert.equal(pub.workflowState, 1);
  assert.equal(pub.publishOn, 1700000000000, "keeps an existing publish date");
  assert.equal(item.workflowState, 4, "the original isn't changed");

  const draft = withWorkflowState(pub, WORKFLOW.DRAFT, now);
  assert.equal(draft.workflowState, 4);
  assert.equal("publishOn" in draft, false);

  const review = withWorkflowState(draft, WORKFLOW.NEEDS_REVIEW, now);
  assert.equal(review.workflowState, 3);
  assert.equal(review.publishOn, Date.UTC(2026, 9, 30, 18, 5), "no date: the current minute");

  assert.throws(() => withWorkflowState(item, WORKFLOW.SCHEDULED), /Can't set/);
  assert.equal(workflowName(3), "Needs review");
});

test("setEventStatus fetches the full event and saves it with the new status", async () => {
  const f = mockFetch([{ status: 200, body: { ...existingItem(), workflowState: 4 } }, { status: 200, body: { ok: true } }]);
  await client(f).setEventStatus({ collectionId: CID, itemId: "ev1", state: WORKFLOW.PUBLISHED });
  assert.equal(f.calls[0].method ?? "GET", "GET");
  assert.equal(f.calls[1].method, "PUT");
  assert.equal(f.calls[1].url, `https://site.squarespace.com/api/content/calendars/${CID}/events/ev1`);
  assert.equal(f.calls[1].json.workflowState, 1);
  assert.equal(f.calls[1].json.title, existingItem().title, "everything else is sent back unchanged");
});

// ---- flyers on existing events

const CDN = "https://images.squarespace-cdn.com/content/v1/0000000000000000000000a1/1700000000000-EXAMPLEASSET0000000/";
const withFlyer = (name, extra = {}) => ({ ...existingItem(), hasFileData: true, assetUrl: CDN + name, ...extra });

test("flyerName reads the featured image's file name from its address", () => {
  assert.equal(flyerName(withFlyer("Watercolor.png")), "Watercolor.png");
  assert.equal(flyerName(withFlyer("Open+Studio%28All+Ages%29.png")), "Open Studio(All Ages).png");
  assert.equal(flyerName(withFlyer("2025+Winter+Camp+-+Clay+Day%21.png")), "2025 Winter Camp - Clay Day!.png");
  // A draft with no image still has an address, ending in a slash.
  assert.equal(flyerName({ hasFileData: false, assetUrl: "https://static1.squarespace.com/static/a/b/c/1793375903970/" }), null);
  assert.equal(flyerName({ assetUrl: "https://static1.squarespace.com/static/a/b/c/1793375903970/" }), null);
  assert.equal(flyerName(existingItem()), null);
});

test("sameFileName ignores case, spaces and punctuation", () => {
  assert.ok(sameFileName("October 18 - Mask Making .png", "october 18 - mask making.PNG"));
  assert.ok(!sameFileName("2026 Fall - Comics.png", "2026 Fall - Printmaking.png"));
  assert.ok(!sameFileName(null, ""));
});

test("diffEvent reports a different flyer, and a blank Image column leaves it alone", () => {
  const item = withFlyer("2026+Fall+-+Comics.png");
  assert.deepEqual(diffEvent(item, plan({ image: "2026 Fall - Comics.png" })), []);
  assert.deepEqual(diffEvent(item, plan({ image: "2026 Fall - Printmaking.png" })), ["flyer"]);
  assert.deepEqual(diffEvent(item, plan({ image: "" })), []);
  assert.deepEqual(diffEvent(existingItem(), plan({ image: "new.png" })), ["flyer"], "no flyer yet: add one");
});

test("checkAgainstSite only needs the flyer file when it will be uploaded", () => {
  const missing = 'Image "a.png" is listed, but no image files are chosen.';
  const same = plan({ image: "a.png", imageError: missing, errors: [missing] });
  checkAgainstSite([same], [{ ...withFlyer("a.png"), recordType: 12 }], TZ);
  assert.deepEqual(same.errors, []);
  const other = plan({ image: "a.png", imageError: missing, errors: [missing] });
  checkAgainstSite([other], [{ ...withFlyer("b.png"), recordType: 12 }], TZ);
  assert.deepEqual(other.errors, [missing]);
  assert.deepEqual(other.changes, ["flyer"]);
});

test("updatedItem swaps the image in the only image block and keeps the rest", () => {
  const item = existingItem();
  item.body.layout.rows[0].columns[0].blocks[0].value.layout = "caption-below";
  const out = updatedItem(item, plan(), ["flyer"], { image: { imageId: "NEW", altText: "TEST - Camp" } });
  const [img] = findImageBlocks(out);
  assert.equal(img.value.imageId, "NEW");
  assert.equal(img.value.altText, "TEST - Camp");
  assert.equal(img.value.layout, "caption-below", "an older event's caption stays");
  assert.equal(out.body.layout.rows[0].columns[0].blocks.length, 2);
  assert.equal(findImageBlocks(item)[0].value.imageId, "img1", "the original isn't changed");
});

test("updatedItem finds image blocks in the older format too", async () => {
  const older = JSON.parse(await readFile(new URL("./fixtures/example-event.editor.json", import.meta.url), "utf8"));
  const out = updatedItem(older, plan(), ["flyer"], { image: { imageId: "NEW", altText: "x" } });
  assert.equal(findImageBlocks(out).length, 1);
  assert.equal(findImageBlocks(out)[0].value.imageId, "NEW");
  assert.match(JSON.stringify(findImageBlocks(out)[0].value.description), /Camp Info|<h3/, "caption text kept");
});

test("updatedItem adds a flyer above the text when there's none, and refuses two", () => {
  const item = existingItem();
  item.body.layout.rows[0].columns[0].blocks.shift();
  const out = updatedItem(item, plan(), ["flyer"], { image: { imageId: "NEW", altText: "a" } });
  const blocks = out.body.layout.rows[0].columns[0].blocks;
  assert.deepEqual(blocks.map((b) => b.definitionName), ["website.components.imageLayout", "website.components.html"]);

  const two = existingItem();
  two.body.layout.rows[0].columns[0].blocks.push(imageBlock("img2"));
  assert.throws(() => updatedItem(two, plan(), ["flyer"], { image: { imageId: "NEW", altText: "" } }), UpdateRefused);
});

test("updateExistingEvent with a new flyer: fetch, upload, save, then featured image", async () => {
  const f = mockFetch([
    { status: 200, body: withFlyer("old.png") },
    ...mediaResponses(),
    { status: 200, body: { ok: true } },
    { status: 200, body: { job: { id: "j1" } } },
    { status: 200, body: [{ status: 3 }] },
  ]);
  const file = new File(["png"], "new.png", { type: "image/png" });
  await clientWith(f).updateExistingEvent({ collectionId: CID, websiteId: WID, itemId: "ev1", plan: plan({ image: "new.png" }), changes: ["flyer"], imageFile: file });
  const steps = f.calls.map((c) => `${c.method ?? "GET"} ${c.url.replace(/^https:\/\/[^/]+/, "").split("?")[0]}`);
  assert.equal(steps[0], `GET /api/content/calendars/${CID}/events/ev1`);
  assert.equal(steps[1], "GET /api/media/auth/v1/library/authorization");
  const put = f.calls.find((c) => c.method === "PUT");
  assert.equal(findImageBlocks(put.json)[0].value.imageId, "img1", "the uploaded image's id");
  assert.equal(put.json.workflowState, 1);
  assert.equal(steps.at(-2), "POST /api/commondata/SaveMedia");
  assert.equal(f.calls.at(-2).body.get("replaceItemId"), "ev1");
});

test("updateExistingEvent refuses before uploading when the flyer can't be placed", async () => {
  const two = withFlyer("old.png");
  two.body.layout.rows[0].columns[0].blocks.push(imageBlock("img2"));
  const f = mockFetch([{ status: 200, body: two }]);
  await assert.rejects(
    clientWith(f).updateExistingEvent({ collectionId: CID, websiteId: WID, itemId: "ev1", plan: plan({ image: "new.png" }), changes: ["flyer"], imageFile: new File(["x"], "new.png") }),
    UpdateRefused,
  );
  assert.equal(f.calls.length, 1, "nothing uploaded");
});
