/**
 * Markdown (e.g. GitHub issues, Linear) → readable text and acceptance criteria.
 *
 * Hand-written, line-based parser covering the subset a ticket body uses: list
 * items (`-`, `*`, `+`, `1.`, `1)`) nested by indentation, task checkboxes,
 * headings, fenced code blocks, emphasis, links and images. Strike-through
 * (`~~…~~`) is kept: a struck criterion is out of scope and must stay visible.
 */

import { resolveStrike, numberCriteria } from './shared.mjs';

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s{0,3}#{1,6}(\s|$)/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const CHECKBOX = /^\[[ xX]\]\s+/;
const INTENT = /^(as a|en tant que)\b/i;

/** Inline markup → plain text: images → alt, links → text, emphasis and code markers removed, `~~` kept. */
function inlineToText(text) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\w*])/g, '$1$2')
    .replace(/(^|[^\w])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![\w])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Classifies the lines of a body, skipping fenced code blocks.
 * Returns { kind: 'blank' | 'heading' | 'item' | 'text' | 'code', ... } per line.
 */
function classify(md) {
  const result = [];
  let inFence = false;
  for (const line of String(md).replace(/\r\n?/g, '\n').split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      result.push({ kind: 'fence', line });
    } else if (inFence) {
      result.push({ kind: 'code', line });
    } else if (line.trim() === '' || RULE.test(line)) {
      result.push({ kind: 'blank', line });
    } else if (HEADING.test(line)) {
      result.push({ kind: 'heading', line });
    } else {
      const m = line.match(LIST_ITEM);
      if (m) {
        const indent = m[1].replace(/\t/g, '  ').length;
        result.push({ kind: 'item', line, indent, marker: m[2], content: m[3].replace(CHECKBOX, ''), rawContent: m[3] });
      } else {
        result.push({ kind: 'text', line });
      }
    }
  }
  return result;
}

/** Markdown → text: markers stripped (except `~~`), bullets and numbering kept, blank lines collapsed. */
export function markdownToText(md) {
  if (!md) return '';
  const out = [];
  for (const entry of classify(md)) {
    if (entry.kind === 'fence') continue;
    if (entry.kind === 'code') out.push(entry.line.trimEnd());
    else if (entry.kind === 'blank') out.push('');
    else if (entry.kind === 'heading') out.push(entry.line.trim().replace(/^(#+)\s*/, '$1 ').replace(/\s+#+$/, ''));
    else if (entry.kind === 'item') {
      const lead = entry.line.match(/^\s*/)[0];
      out.push(`${lead}${entry.marker} ${inlineToText(entry.rawContent)}`);
    } else out.push(inlineToText(entry.line));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** A criterion is "struck" when all its visible text is inside `~~…~~` (a leading label may stay outside). */
function criterionFrom(raw) {
  const visible = inlineToText(raw);
  const outside = visible.replace(/~~[\s\S]*?~~/g, '').replace(/\s+/g, ' ').trim();
  return resolveStrike(visible, outside);
}

/**
 * Acceptance criteria of a Markdown body.
 *
 * With lists: one criterion per item, nested items included in document order
 * (a continuation line is joined to its item). Without any list: one criterion
 * per paragraph (consecutive lines joined), the first paragraph being dropped when its
 * first line is an intent sentence ("As a …", "En tant que …"). Headings and code blocks are never criteria.
 */
export function extractCriteriaFromMarkdown(md) {
  if (!md) return [];
  const entries = classify(md);
  const fragments = [];
  if (entries.some((e) => e.kind === 'item')) {
    let open = false; // a list item can still take continuation lines
    for (const e of entries) {
      if (e.kind === 'item') {
        fragments.push(e.content);
        open = true;
      } else if (e.kind === 'text' && open) {
        fragments[fragments.length - 1] += ` ${e.line.trim()}`;
      } else {
        open = false;
      }
    }
  } else {
    let paragraph = [];
    let first = true;
    const flush = () => {
      if (paragraph.length === 0) return;
      // The whole first paragraph is dropped when it opens with an intent sentence (it may be hard-wrapped).
      const intent = first && INTENT.test(inlineToText(paragraph[0]));
      first = false;
      if (!intent) fragments.push(paragraph.join(' '));
      paragraph = [];
    };
    for (const e of entries) {
      if (e.kind === 'text') paragraph.push(e.line.trim());
      else flush();
    }
    flush();
  }
  return numberCriteria(fragments.map(criterionFrom));
}
