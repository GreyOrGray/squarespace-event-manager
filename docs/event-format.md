# How an event is stored

Findings from the public JSON of one real event, a summer camp from 2026. The JSON came from opening the event page with `?format=json-pretty` while logged in. An anonymized copy of its `item` part is in `test/fixtures/example-event.item.json`, with the names, text, address and ids replaced.

This shows what Squarespace **stores and renders**. It does not show the request the editor **sends** to create an event. That comes from the network recording (see `recording.md`), and the two may differ.

## Fields that matter

| Field | Example | Notes |
|---|---|---|
| `title` | `Summer Camp: Watercolor **FULL**` | "**FULL**" is added by hand once a camp fills. |
| `urlId` | `summer-camp-2026-watercolor` | Address slug. Set by hand, not auto-generated from the title. The importer should generate it. |
| `startDate`, `endDate` | `1785166200414`, `1785529800414` | Milliseconds since 1970 (UTC). Decodes to Mon 2026-07-27 11:30 and Fri 2026-07-31 16:30 in the site's time zone (America/New_York in the fixture). |
| `structuredContent` | `{"_type": "CalendarEvent", "startDate": ..., "endDate": ...}` | Duplicates the dates. Probably what calendar sites read. |
| `location` | addressTitle, addressLine1, addressLine2, addressCountry, mapLat, mapLng, mapZoom | Same for every class. Copy from an existing event. |
| `excerpt` | HTML | Same text as the body, without the image. |
| `body` | HTML | See below. |
| `assetUrl`, `filename`, `systemDataId` | `Watercolor.png` on images.squarespace-cdn.com | The featured image, already uploaded to Squarespace's image store. |
| `workflowState` | `1` | Published. The draft value is still to be confirmed from the recording. |
| `tags`, `categories` | empty | Not used today. |
| `website.timeZone` | `America/New_York` | Site time zone. Dates must be converted with this, including daylight saving. The importer reads it when it connects to the Events page. |

## The body is one image block

The body is a single image block (block type 1337). All of the text lives in that image's **caption**, not in a separate text block. The editor's "Edit" view shows image, heading and text as one unit for this reason.

The caption contains, in order:

1. `<h3>` notice, for example "*** Camp is Full ***". Optional.
2. `<h4>` notice subheading, for example "Please email about waitlist options". Optional.
3. Description paragraphs. Per class.
4. **Camp Info** list: `Ages 8-12`, `July 27 - July 31 : 11:30am - 4:30pm`, `Tuition: $280`. Built from spreadsheet columns.
5. **Discounts (one per family):** list: early bird deadline and multiple-children discount. Same for the whole season.
6. An empty paragraph, then two boilerplate paragraphs: what to bring, and the program mission. Same for the whole season.

The early bird deadline in the 2026 event still reads "4/20/2025". Making it a single season setting prevents that.

## What this means for the importer

- **The caption layout was inherited, not chosen.** It came from duplicating an older event each season. The importer puts the same text in an ordinary text block instead, and the flyer is added by hand above it.
- **Per-row columns:** title, dates, times, ages, tuition, notice heading and subheading, description.
- **Season settings, entered once per import:** early bird deadline, discount lines, what-to-bring and mission paragraphs, location.
- **The body HTML above is rendered output.** The editor probably saves a block layout in a different format. The recording will show the exact format to send.
