# Squarespace Event Importer

A Chrome extension that turns a spreadsheet of classes into **draft** events on a Squarespace 7.1 site. Squarespace has no official way to create events in bulk, so the extension sends the same requests the Squarespace editor sends, using the login already open in the browser.

This is an unofficial tool, not made or supported by Squarespace. It relies on the editor's internal requests, which can change without notice.

Status: **working**. Creating drafts, flyer upload and updating existing events were all tested on the live site on 2026-10-30. Saved seasons, the location setting and status changes were added the same day and need their first live test.

Open the Events page in the editor and click the extension button. The panel takes season settings, a spreadsheet and optionally the flyer images, then previews every event with problems flagged.

- **New rows** become draft events, with the flyer above the text and as the featured image.
- **Rows already on the site** are compared with the event. Changed title, dates, text or flyer can be applied with **Update events**, which changes published events right away.
- **Fixing a flyer:** when the Image column names a different file from the event's featured image, the update replaces the flyer in the page and the featured image. A blank Image column leaves the flyer alone. The flyer files only need choosing when one is being replaced.
- **Marking a camp full:** put yes in the Full column and run an update. The title gets " \*\*FULL\*\*" and the full-camp notice is added. Both texts are season settings.
- **Changing status:** rows already on the site get a tick box. Pick Draft, Needs review or Published at the bottom and the ticked events are changed. Publishing shows them on the live site right away.
- **All events on this page** lists every event on the Events page, no spreadsheet needed, with its start and status. Filter by upcoming or past, status and title, tick events, and change their status the same way.

## Seasons

Season settings are saved by name in the browser. For a new year, pick last year's season, click **Copy**, name it, and change what's different, such as the early bird deadline.

**Export** saves every season to a file, and **Import** adds them back. Use it as a backup: removing the extension from Chrome deletes the saved seasons.

The location fields are optional. Without them, new events copy the location from the newest event on the site.

Dates and times in the spreadsheet are in the site's time zone, which the importer reads from the site when it connects.

## Install (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `extension` folder.
3. Pin the extension. Open the site's editor (an address containing `/config`) and click the extension's button.

After editing the code, click the reload icon on the extension's card, then reload the Squarespace tab.

## Spreadsheet

Start from `examples/template.csv`. When saving from Excel, choose **CSV UTF-8** so accented characters and curly quotes survive.

For testing: `examples/test-events.csv` creates two clearly labeled fake events, one with `examples/test-flyer.png`. `examples/test-events-update.csv` then marks the first one full and changes the second one's end time.

## Development

```
npm test
```

Tests use Node's built-in test runner. No install step is needed.

| Path | What it is |
|---|---|
| `extension/` | The extension Chrome loads: manifest, background script, panel, shared code in `lib/` |
| `test/` | Unit tests for the code in `extension/lib/` |
| `test/fixtures/` | Anonymized Squarespace data used by the tests |
| `examples/` | Spreadsheet template and test spreadsheets |
| `samples/` | Ignored by git. A place for your own spreadsheets and flyers |
| `docs/event-format.md` | How Squarespace stores an event |
| `docs/recording.md` | How to record the editor creating an event |
| `docs/squarespace-requests.md` | The requests the editor sends, including image uploads |

**Never commit network recordings (`.har` files).** They contain a live login session. `.gitignore` blocks them.

## Milestones

1. Skeleton: panel in the editor, CSV preview. **Done.**
2. Spreadsheet side: validation, date and time zone handling, season settings, body template, preview of the generated event. **Done.**
3. Recording: capture and document the editor's requests. **Done**, see `docs/squarespace-requests.md`.
4. Create drafts, with a duplicate check. Flyer images are added by hand afterwards. **Done.**
5. Test run with fake events, then delete them. **Done** on 2026-10-30.
6. Update existing events, including marking a camp full. **Done.**
7. Upload flyers automatically. **Done.**
8. Saved seasons, a location setting and changing status in bulk. **Built; needs a live test.**
9. List of all events on the page, for changing status without a spreadsheet. **Built; needs a live test.**
10. Replace the flyer on existing events when the Image column names a different file. **Built; needs a live test.**

## License

MIT. See `LICENSE`.
