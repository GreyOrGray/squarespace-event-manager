// Builds the JSON the Squarespace editor sends when it creates and saves an event.
// Shapes copied from network recordings; see docs/squarespace-requests.md.

export const WORKFLOW_DRAFT = 4;
export const WORKFLOW_PUBLISHED = 1;

/** 20 hex characters, like the editor's block ids. */
export function newBlockId(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return [...random(10)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const px = (value) => ({ unit: "px", value });
const pct = (value) => ({ unit: "%", value });
const deg = (value) => ({ unit: "deg", value });

/** A text block exactly as the editor saves one, holding `html`. */
export function textBlock(html, id = newBlockId()) {
  return {
    type: 1337,
    id,
    definitionName: "website.components.html",
    value: {
      animations: [],
      breakpointOverrides: {},
      containerStyles: {
        backgroundColor: { type: "THEME_COLOR" },
        backgroundEnabled: false,
        blendMode: "normal",
        blur: { blurRadius: px(15), enabled: false, filterType: "backdrop" },
        borderRadii: { bottomLeft: px(0), bottomRight: px(0), topLeft: px(0), topRight: px(0) },
        padding: { bottom: pct(6), left: pct(6), right: pct(6), top: pct(6) },
        stroke: {
          color: { sitePaletteColor: { alphaModifier: 1, colorName: "black" }, type: "SITE_PALETTE_COLOR" },
          style: "none",
          thickness: px(2),
        },
      },
      engine: "wysiwyg",
      html,
      source: html,
      textAttributes: [],
      transforms: {
        offset: { x: px(0), y: px(0) },
        opacity: pct(100),
        origin: { x: pct(50), y: pct(50) },
        rotation: { z: deg(0) },
        scale: { x: pct(100), y: pct(100) },
        skew: { x: deg(0), y: deg(0) },
      },
    },
  };
}

/** An image block exactly as the editor saves one, showing image item `imageId` with no caption. */
export function imageBlock(imageId, altText = "", id = newBlockId()) {
  return {
    type: 1337,
    id,
    definitionName: "website.components.imageLayout",
    value: {
      altText,
      aspectRatio: null,
      borderRadii: { bottomLeft: px(0), bottomRight: px(0), topLeft: px(0), topRight: px(0) },
      buttonText: "Learn more",
      combinationAnimation: "site-default",
      description: null,
      designLayout: "inline",
      filename: "",
      imageCropType: "css_styles",
      imageId,
      imageLink: "none",
      imageMask: "circle",
      imagePosition: "left",
      individualImageAnimation: "site-default",
      individualTextAnimation: "site-default",
      layout: "caption-hidden",
      lightbox: false,
      lightboxTheme: "dark",
      linkTo: null,
      newwindow: false,
      stretch: false,
      subtitle: null,
      title: null,
      hSize: null,
      floatDir: null,
    },
  };
}

/**
 * The body layout: one full-width column holding the flyer image (if any) and then
 * the text block.
 */
export function bodyLayout(html, itemId, blockId, image = null) {
  const blocks = [];
  if (image) blocks.push(imageBlock(image.imageId, image.altText, image.blockId));
  blocks.push(textBlock(html, blockId));
  return {
    layout: {
      columns: 12,
      rows: [{ columns: [{ span: 12, blocks }] }],
      legacyPromotedLayout: true,
      promotedBlockId: null,
      collectionId: null,
      parentItemId: itemId,
      span: 12,
    },
  };
}

/**
 * First request: create an empty draft, the way the editor does when you click "+".
 * Dates and location are included so the draft is never left without them.
 */
export function createBody({ collectionId, websiteId, authorId, location, start, end, now = Date.now() }) {
  return {
    addedOn: now,
    publishOn: now,
    websiteId,
    mediaFocalPoint: { x: 0.5, y: 0.5 },
    likeCount: 0,
    dislikeCount: 0,
    commentCount: 0,
    publicCommentCount: 0,
    workflowState: WORKFLOW_DRAFT,
    urlId: null,
    proxyForId: null,
    childType: null,
    updatedOn: null,
    unsaved: null,
    title: null,
    body: { raw: false, layout: { columns: 12, rows: [] } },
    excerpt: { html: "", raw: false },
    displayIndex: 0,
    starred: false,
    passthrough: false,
    tags: [],
    categories: [],
    systemDataId: null,
    systemDataVariants: null,
    systemDataOrigin: null,
    contentType: null,
    fileName: null,
    dataSize: null,
    sourceUrl: null,
    mediaProcessingState: null,
    colorData: null,
    clickThroughUrl: null,
    customContent: null,
    authorId,
    category: null,
    structuredContent: { _type: "CalendarEvent", startDate: start, endDate: end },
    recordType: 12,
    collectionId,
    location,
  };
}

/**
 * Second request: the whole item as returned by the create request, with the
 * event's content filled in. The editor always sends the whole item on save.
 * `image` is { imageId, altText } for an uploaded flyer, or null.
 */
export function saveBody(created, plan, { blockId, image = null } = {}) {
  return {
    ...created,
    title: plan.title,
    urlId: plan.slug,
    body: bodyLayout(plan.captionHtml, created.id, blockId, image),
    excerpt: { html: plan.excerptHtml, raw: false },
    startDate: plan.start,
    endDate: plan.end,
    structuredContent: { ...(created.structuredContent ?? {}), startDate: plan.start, endDate: plan.end },
    tags: plan.tags,
    categories: plan.categories,
    workflowState: WORKFLOW_DRAFT,
    unsaved: false,
  };
}

/** Text blocks in an item's body, in order. */
export function findTextBlocks(item) {
  const found = [];
  for (const row of item?.body?.layout?.rows ?? []) {
    for (const col of row.columns ?? []) {
      for (const block of col.blocks ?? []) {
        if (block.definitionName === "website.components.html" && typeof block.value?.html === "string") found.push(block);
      }
    }
  }
  return found;
}

export class UpdateRefused extends Error {}

/** Image blocks in an item's body, with where they are. Older events use a different block format, but all keep imageId. */
export function findImageBlocks(item) {
  const found = [];
  for (const row of item?.body?.layout?.rows ?? []) {
    for (const col of row.columns ?? []) {
      for (const block of col.blocks ?? []) {
        if (typeof block?.value?.imageId === "string") found.push(block);
      }
    }
  }
  return found;
}

/**
 * Puts the flyer image into the body: replaces the image in the event's only image
 * block, keeping its caption and layout, or adds one above the text when there's none.
 */
function placeFlyer(out, image) {
  const blocks = findImageBlocks(out);
  if (blocks.length > 1) {
    throw new UpdateRefused(`This event has ${blocks.length} images in its page, so the importer can't tell which is the flyer. Replace it by hand.`);
  }
  if (blocks.length === 1) {
    blocks[0].value.imageId = image.imageId;
    blocks[0].value.altText = image.altText;
    return;
  }
  const text = findTextBlocks(out)[0];
  for (const row of out.body?.layout?.rows ?? []) {
    for (const col of row.columns ?? []) {
      const at = text ? (col.blocks ?? []).indexOf(text) : 0;
      if (at >= 0 && col.blocks) {
        col.blocks.splice(at, 0, imageBlock(image.imageId, image.altText));
        return;
      }
    }
  }
  throw new UpdateRefused("This event's page has no content to add the flyer to. Add it by hand.");
}

// Squarespace's own numbering, from the editor's code.
export const WORKFLOW = Object.freeze({ PUBLISHED: 1, SCHEDULED: 2, NEEDS_REVIEW: 3, DRAFT: 4 });
export const WORKFLOW_NAMES = Object.freeze({ 1: "Published", 2: "Scheduled", 3: "Needs review", 4: "Draft" });

/** States the importer can set. Scheduling needs a date, so it's left to the editor. */
export const SETTABLE_STATES = [WORKFLOW.DRAFT, WORKFLOW.NEEDS_REVIEW, WORKFLOW.PUBLISHED];

export function workflowName(state) {
  return WORKFLOW_NAMES[state] ?? "Unknown status";
}

/**
 * The full item with a new status, ready to save. Does what the editor's status
 * picker does: a draft has no publish date; anything else keeps its publish date,
 * or gets the current minute if it has none.
 */
export function withWorkflowState(item, state, now = Date.now()) {
  if (!SETTABLE_STATES.includes(state)) throw new Error(`Can't set status ${state}.`);
  const out = structuredClone(item);
  out.workflowState = state;
  if (state === WORKFLOW.DRAFT) {
    delete out.publishOn;
  } else if (out.publishOn == null) {
    out.publishOn = Math.floor(now / 60000) * 60000;
  }
  return out;
}

/**
 * The full existing item with the planned changes applied, ready to save.
 * Only the listed `changes` are touched. Everything else, including whether the
 * event is published and any images added by hand, is kept as it is.
 *
 * Text is only replaced in an event with exactly one text block, which is how the
 * importer creates them. Older events keep their text in an image caption, and
 * those are refused rather than guessed at.
 *
 * For a "flyer" change, `image` is { imageId, altText } of the uploaded flyer.
 * The featured image is set separately.
 */
export function updatedItem(item, plan, changes, { image = null } = {}) {
  const out = structuredClone(item);
  if (changes.includes("title")) out.title = plan.title;
  if (changes.includes("dates")) {
    out.startDate = plan.start;
    out.endDate = plan.end;
    out.structuredContent = { ...(out.structuredContent ?? {}), startDate: plan.start, endDate: plan.end };
  }
  if (changes.includes("text")) {
    const blocks = findTextBlocks(out);
    if (blocks.length !== 1) {
      throw new UpdateRefused(
        blocks.length === 0
          ? "This event has no text block (older events keep their text in the image caption), so its text has to be updated by hand."
          : `This event has ${blocks.length} text blocks, so the importer can't tell which to replace. Update its text by hand.`,
      );
    }
    blocks[0].value.html = plan.captionHtml;
    blocks[0].value.source = plan.captionHtml;
    out.excerpt = { ...(out.excerpt ?? {}), html: plan.excerptHtml, raw: false };
  }
  if (changes.includes("flyer")) {
    if (!image) throw new Error("No uploaded flyer to put in the page.");
    placeFlyer(out, image);
  }
  return out;
}
