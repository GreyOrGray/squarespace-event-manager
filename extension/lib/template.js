// Builds the event text (body text block and excerpt), in the same structure and
// markup the Squarespace editor produced for the 2026 camps' image captions.
import { splitLines, splitParagraphs } from "./season.js";

export function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The visible text of some HTML, one line per paragraph or heading, with spacing
 * normalised. Used to tell whether an event's text really changed, ignoring markup
 * differences Squarespace may introduce when it saves.
 */
export function htmlToText(html) {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const P_ATTRS = 'class="" style="white-space:pre-wrap;"';

/** A paragraph. Single line breaks inside it become <br>. */
function para(text) {
  return `<p ${P_ATTRS}>${escapeHtml(text).replace(/\r?\n/g, "<br>")}</p>`;
}

function boldPara(text) {
  return `<p ${P_ATTRS}><strong>${escapeHtml(text)}</strong></p>`;
}

function centeredHeading(tag, text) {
  return `<${tag} style="text-align:center;white-space:pre-wrap;"><strong>${escapeHtml(text)}</strong></${tag}>`;
}

function list(items) {
  return `<ul data-rte-list="default">${items.map((i) => `<li>${para(i)}</li>`).join("")}</ul>`;
}

const EMPTY_PARA = `<p class="" data-rte-preserve-empty="true" style="white-space:pre-wrap;"></p>`;

/**
 * @param {object} ev
 * @param {string} ev.notice          e.g. "*** Camp is Full ***" (optional)
 * @param {string} ev.noticeDetail    e.g. "Please email about waitlist options" (optional)
 * @param {string} ev.description     paragraphs separated by blank lines
 * @param {string[]} ev.infoItems     e.g. ["Ages 10+", "July 27 - July 31 : 11:30am - 4:30pm", "Tuition: $320"]
 * @param {object} season             see season.js
 * @param {string} deadlineText       early bird deadline as shown, e.g. "4/20/2027"
 */
export function buildCaptionHtml(ev, season, deadlineText) {
  const parts = [];

  if (ev.notice) parts.push(centeredHeading("h3", ev.notice));
  if (ev.noticeDetail) parts.push(centeredHeading("h4", ev.noticeDetail));

  for (const p of splitParagraphs(ev.description)) parts.push(para(p));

  if (ev.infoItems.length) {
    parts.push(boldPara(season.infoHeading));
    parts.push(list(ev.infoItems));
  }

  const discounts = splitLines(season.discounts).map((l) => l.replaceAll("{deadline}", deadlineText));
  if (discounts.length) {
    parts.push(boldPara(season.discountsHeading));
    parts.push(list(discounts));
  }

  const closing = splitParagraphs(season.closing);
  if (closing.length) {
    parts.push(EMPTY_PARA);
    for (const p of closing) parts.push(para(p));
  }

  return parts.join("");
}
