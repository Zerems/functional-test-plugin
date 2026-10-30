/**
 * Ticket body → text and acceptance criteria, whatever the tracker's format.
 * `body = { format: 'html' | 'markdown' | 'text', content }`.
 */
import { htmlToText, extractCriteriaFromHtml } from './html.mjs';
import { markdownToText, extractCriteriaFromMarkdown } from './markdown.mjs';

/** Plain text: one criterion per non-empty line. */
function extractCriteriaFromText(text) {
  return String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l, i) => ({ number: i + 1, text: l, struck: false }));
}

/** Readable text of a body. */
export function bodyToText(body) {
  const content = body?.content;
  if (!content) return '';
  if (body.format === 'html') return htmlToText(content);
  if (body.format === 'markdown') return markdownToText(content);
  return String(content).trim();
}

/** Acceptance criteria `{ number, text, struck }[]` of a body. */
export function extractCriteria(body) {
  const content = body?.content;
  if (!content) return [];
  if (body.format === 'html') return extractCriteriaFromHtml(content);
  if (body.format === 'markdown') return extractCriteriaFromMarkdown(content);
  return extractCriteriaFromText(content);
}
