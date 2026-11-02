// Talks to the Squarespace editor's own API, from inside the editor page, using the
// login that's already open. See docs/squarespace-requests.md for the requests.
import { createBody, saveBody, updatedItem, withWorkflowState } from "./item.js";

export const MEDIA_ORIGIN = "https://media-api.squarespace.com";

export class SquarespaceError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** The editor's security token, kept in the "crumb" cookie and sent as x-csrf-token. */
export function readCrumb(cookieString) {
  for (const part of String(cookieString ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "crumb") return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** The collection id from an editor address like /config/pages/0123456789abcdef01234567 */
export function collectionIdFromPath(pathname) {
  const m = String(pathname).match(/^\/config\/pages\/([0-9a-f]{24})(?:[/?#]|$)/);
  return m ? m[1] : null;
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class SquarespaceClient {
  /**
   * @param {object} opts
   * @param {string} opts.origin             the editor's address, e.g. https://example-site.squarespace.com
   * @param {() => string} opts.cookies      returns document.cookie
   * @param {typeof fetch} opts.fetch
   * @param {(ms:number) => Promise<void>} [opts.sleep]   for waiting on image processing
   * @param {string} [opts.mediaOrigin]
   */
  constructor({ origin, cookies, fetch: fetchImpl, sleep = realSleep, mediaOrigin = MEDIA_ORIGIN }) {
    this.origin = origin;
    this.cookies = cookies;
    this.fetch = fetchImpl;
    this.sleep = sleep;
    this.mediaOrigin = mediaOrigin;
  }

  /**
   * One request. `body` may be a plain object (sent as JSON), FormData, URLSearchParams
   * or a string. Requests to the site carry the security token; requests to the media
   * service don't, matching what the editor sends.
   */
  async request(method, url, body, { headers: extra = {}, expectJson = true, credentials = "include" } = {}) {
    const full = url.startsWith("http") ? url : this.origin + url;
    const toSite = full.startsWith(this.origin);
    const headers = { accept: "application/json, text/plain, */*", ...extra };

    if (toSite) {
      const crumb = readCrumb(this.cookies());
      if (crumb) headers["x-csrf-token"] = crumb;
      else if (method !== "GET") {
        throw new SquarespaceError("Couldn't find Squarespace's security token. Reload the editor page and try again.");
      }
    }

    let payload = body;
    if (body !== undefined && !(body instanceof FormData) && !(body instanceof URLSearchParams) && typeof body !== "string") {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }

    const label = `${method} ${full.replace(this.origin, "").split("?")[0]}`;
    let res;
    try {
      res = await this.fetch(full, { method, headers, credentials, body: payload });
    } catch (err) {
      throw new SquarespaceError(`Couldn't reach Squarespace for ${label} (${err.message}). Check the connection and try again.`);
    }

    const text = await res.text();
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403
        ? " You may have been logged out. Reload the editor and try again."
        : "";
      throw new SquarespaceError(`Squarespace answered ${res.status} for ${label}.${hint} ${text.slice(0, 200)}`.trim(), res.status);
    }
    if (!expectJson || !text) return text || null;
    try {
      return JSON.parse(text);
    } catch {
      throw new SquarespaceError(`Squarespace sent an unexpected reply for ${label}.`, res.status);
    }
  }

  /** Settings of a page (collection). Includes websiteId, typeName and fullUrl. */
  getCollectionSettings(collectionId) {
    return this.request("GET", `/api/commondata/GetCollectionSettings?collectionId=${encodeURIComponent(collectionId)}`);
  }

  /**
   * The logged-in account's id, needed as the author of new events, and the
   * site's time zone, which event times are entered in.
   * Any page's JSON view includes both while logged in, e.g. /events?format=json
   */
  async getSiteInfo(pagePath) {
    const res = await this.request("GET", `${pagePath}?format=json`);
    const accountId = res?.authenticatedAccount?.id;
    if (!accountId) {
      throw new SquarespaceError("Couldn't tell which Squarespace account is logged in. Reload the editor and try again.");
    }
    return { accountId, timeZone: res?.website?.timeZone || null };
  }

  /** Every item in the collection, following the pages of results. */
  async listItems(collectionId, { maxPages = 50 } = {}) {
    const items = [];
    let path = `/api/content-collections/${collectionId}/content-items?limit=50`;
    for (let page = 0; page < maxPages; page++) {
      const res = await this.request("GET", path);
      items.push(...(res?.results ?? []));
      if (!res?.hasNextPage || !res.nextPageStart) return items;
      path = `/api/content-collections/${collectionId}/content-items?limit=50&start=${encodeURIComponent(res.nextPageStart)}`;
    }
    throw new SquarespaceError("The events list is longer than expected. Stopping to be safe.");
  }

  getEvent(collectionId, id) {
    return this.request("GET", `/api/content/calendars/${collectionId}/events/${id}`);
  }

  putEvent(collectionId, item) {
    return this.request("PUT", `/api/content/calendars/${collectionId}/events/${item.id}`, item);
  }

  /** Polls `check` until it returns a value, waiting between tries. */
  async waitFor(what, check, { tries = 30, delayMs = 1000 } = {}) {
    for (let i = 0; i < tries; i++) {
      await this.sleep(delayMs);
      const done = await check();
      if (done) return done;
    }
    throw new SquarespaceError(`Squarespace took too long processing ${what}.`);
  }

  /**
   * Uploads an image to the site's media library for use in a body image block.
   * Returns the image item's id. Same steps as the editor: get a media token,
   * hand it to the media service, upload, wait, then register the image with the site.
   */
  async uploadBodyImage(file, { websiteId, altText = "" }) {
    const auth = await this.request("GET", "/api/media/auth/v1/library/authorization");
    if (!auth?.token) throw new SquarespaceError("Squarespace didn't give a media upload token.");
    await this.request("POST", `${this.mediaOrigin}/user/authorize`, auth.token, {
      headers: { "content-type": "text/plain" },
      expectJson: false,
    });

    const form = new FormData();
    form.append("image", file, file.name);
    const upload = await this.request("POST", `${this.mediaOrigin}/uploads/image`, form, {
      headers: { "x-library-id": websiteId, "x-sqsp-source": "web upload" },
    });
    if (!upload?.jobId) throw new SquarespaceError("The image upload didn't return a job id.");

    const job = await this.waitFor(`the image ${file.name}`, async () => {
      // The media service's status reply doesn't allow credentials, so the editor sends
      // this one without cookies; sending them makes Chrome block the reply.
      const list = await this.request("GET", `${this.mediaOrigin}/jobs/image/status?job-list=${encodeURIComponent(upload.jobId)}`,
        undefined, { credentials: "omit" });
      const status = Array.isArray(list) ? list[0] : null;
      if (status && status.isActive === false && status.isSuccess === false) {
        throw new SquarespaceError(`Squarespace couldn't process the image ${file.name}.`);
      }
      return status?.isSuccess && status.assetId ? status : null;
    }, { delayMs: Math.max(500, upload.checkStatusAfterMs ?? 1000) });

    const ref = await this.request("POST", "/api/uploads/images/asset-reference",
      new URLSearchParams({ assetId: job.assetId, libraryId: websiteId, recordType: "2" }));
    const imageId = ref?.media?.[0]?.id;
    if (!imageId) throw new SquarespaceError("Squarespace didn't return the uploaded image's id.");

    if (altText) {
      await this.request("POST", "/api/commondata/SaveItemField",
        new URLSearchParams({ itemId: imageId, field: "altText", value: altText }));
    }
    return imageId;
  }

  /** Uploads `file` as the event's featured image and waits until it's processed. */
  async setFeaturedImage(file, { collectionId, itemId }) {
    const form = new FormData();
    form.append("process", "true");
    form.append("contentType", file.type || "image/png");
    form.append("isWordpressXmlFile", "false");
    form.append("recordType", "2");
    form.append("collectionId", collectionId);
    form.append("replaceItemId", itemId);
    form.append("imageDestination", "content-item-main-image");
    form.append("fileName", file.name);
    form.append("fileSize", String(file.size));
    form.append("Filedata", file, file.name);

    const res = await this.request("POST", "/api/commondata/SaveMedia", form);
    const jobId = res?.job?.id;
    if (!jobId) return; // Nothing to wait for.
    await this.waitFor(`the featured image ${file.name}`, async () => {
      const list = await this.request("GET", `/api/rest/jobs?id=${encodeURIComponent(jobId)}`);
      return Array.isArray(list) && list[0]?.status === 3 ? list[0] : null;
    });
  }

  /**
   * Creates one draft event, the way the editor does: an empty draft first, then a
   * save with the content. With an image file, the flyer is uploaded and placed above
   * the text, then set as the featured image.
   * @returns the saved item
   */
  async createDraftEvent({ collectionId, websiteId, authorId, location, plan, imageFile = null }) {
    const created = await this.request(
      "POST",
      `/api/content/calendars/${collectionId}/events`,
      createBody({ collectionId, websiteId, authorId, location, start: plan.start, end: plan.end }),
    );
    if (!created?.id) throw new SquarespaceError("Squarespace didn't return the new event's id.");

    let step = "saving the event";
    try {
      let image = null;
      if (imageFile) {
        step = "uploading the flyer";
        image = { imageId: await this.uploadBodyImage(imageFile, { websiteId, altText: plan.title }), altText: plan.title };
      }
      step = "saving the event";
      const saved = await this.request(
        "PUT",
        `/api/content/calendars/${collectionId}/events/${created.id}`,
        saveBody(created, plan, { image }),
      );
      if (imageFile) {
        step = "setting the featured image";
        await this.setFeaturedImage(imageFile, { collectionId, itemId: created.id });
      }
      return saved;
    } catch (err) {
      err.message = `The draft was created, but ${step} failed: ${err.message} Finish or delete the draft by hand (${created.fullUrl ?? created.id}).`;
      throw err;
    }
  }

  /**
   * Applies the planned changes to an existing event. Fetches the full event first,
   * changes only what's listed, and saves it back. Published events stay published.
   * A "flyer" change uploads `imageFile`, puts it in the page in place of the old
   * one, then makes it the featured image, as when creating.
   */
  async updateExistingEvent({ collectionId, websiteId, itemId, plan, changes, imageFile = null }) {
    const item = await this.getEvent(collectionId, itemId);
    const flyer = changes.includes("flyer");
    if (flyer && !imageFile) throw new SquarespaceError(`The flyer ${plan.image} isn't among the chosen images.`);
    // Check the whole change first, so nothing is uploaded for an update that would be refused.
    updatedItem(item, plan, changes, { image: flyer ? { imageId: "check", altText: "" } : null });

    let image = null;
    if (flyer) image = { imageId: await this.uploadBodyImage(imageFile, { websiteId, altText: plan.title }), altText: plan.title };
    const saved = await this.putEvent(collectionId, updatedItem(item, plan, changes, { image }));
    if (flyer) {
      try {
        await this.setFeaturedImage(imageFile, { collectionId, itemId });
      } catch (err) {
        err.message = `The flyer in the page was replaced, but setting the featured image failed: ${err.message} Set it by hand in the event's settings.`;
        throw err;
      }
    }
    return saved;
  }

  /** Sets an existing event's status (draft, needs review or published). */
  async setEventStatus({ collectionId, itemId, state }) {
    const item = await this.getEvent(collectionId, itemId);
    return this.putEvent(collectionId, withWorkflowState(item, state));
  }
}
