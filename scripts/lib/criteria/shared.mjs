/**
 * Logic shared by the HTML and Markdown extractors: when a criterion counts as
 * struck, and how the final list is filtered and numbered.
 */

/** What may stay outside the strike-through of a struck criterion: a label such as "CA2 :", "AC 2 -", "3.". */
const LABEL_ONLY = /^(ca|ac|crit[èe]re|criteria?)?\s*\d*\s*[:\-–.)]*$/i;

/**
 * Decides whether a criterion is struck.
 * `visible` is its text with `~~…~~` markers; `outside` is the same text with every struck part removed.
 * Struck means there is a strike-through and nothing but (at most) a label stays outside it.
 * A struck criterion has its `~~` markers removed; otherwise the text is kept as is.
 */
export function resolveStrike(visible, outside) {
  const struck = visible.includes('~~') && (outside.length === 0 || LABEL_ONLY.test(outside));
  return { text: struck ? visible.replace(/~~/g, '').replace(/\s+/g, ' ').trim() : visible, struck };
}

/** Drops empty criteria and numbers the rest from 1: `{ number, text, struck }[]`. */
export function numberCriteria(items) {
  return items.filter((c) => c.text.length > 0).map((c, i) => ({ number: i + 1, text: c.text, struck: c.struck }));
}
