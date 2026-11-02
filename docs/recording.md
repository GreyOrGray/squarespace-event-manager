# Recording how the editor creates an event

This captures exactly what the Squarespace editor sends when you create an event. It takes about 15 minutes.

**The recording contains your login session, which works like a temporary password.** Save it in the `recordings/` folder, which git ignores, or anywhere outside this repo. Never commit it, email it, or upload it. Log out of Squarespace when you're done, which ends that session, and delete the file once the importer works.

Use the **Network** tab, not the **Recorder** panel. Recorder saves your clicks so they can be replayed, and its recordings are named like "Recording 10/30/2026 at 9:51:48 AM". It doesn't capture the data the editor sends, which is what we need.

## Steps

1. In Chrome, log into the site and open the editor. Go to **Pages**, then **Events**.
2. Press **F12** to open developer tools. Along the top row of tabs (Elements, Console, Sources, **Network**...), click **Network**. If you can't see it, click the **>>** at the end of the row.
3. Tick **Preserve log**. Click the clear button (the circle with a line through it) so the list is empty.
4. Just below that, click the **Fetch/XHR** filter so only data requests are shown. The list should fill with rows as you work in the editor.
5. Create a test event by hand, the way you normally would:
   - Title: `TEST - recording (delete me)`
   - Start and end dates over two days in the future, with times
   - Add an image to the body, with a short caption that has a heading, a paragraph and a bulleted list
   - In Settings, set the featured image and a short excerpt
   - Leave it as a **draft**. Don't publish.
6. Save the event, then close the editor panel.
7. Save the recording. In the Network tab's toolbar, click the **download arrow** (Export HAR). If it offers a choice, pick the **sanitized** version, which leaves out cookies and login headers. Chrome opens a save dialog: save it as `recordings\create-event.har` inside this repository's folder, creating the `recordings` folder if needed. Older Chrome versions instead have **Save all as HAR with content** on the right-click menu of any row.
8. Delete the test event in Squarespace.
9. Log out of Squarespace, then log back in. This ends the session saved in the recording.

## Afterwards

The recording is read locally to work out the request sequence: creating the item, uploading the image, saving the body and settings. The findings go in `docs/squarespace-requests.md` without any cookies or tokens.
