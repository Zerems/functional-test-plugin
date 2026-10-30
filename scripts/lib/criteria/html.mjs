/**
 * Tracker-rendered HTML (e.g. Jira `renderedFields`) → readable text and criteria.
 *
 * Strike-through (`<del>`, `<s>`, `<strike>`) is kept as `~~…~~`: in a ticket a
 * struck criterion is out of scope and must stay visible so it is not tested
 * by mistake.
 */

import { resolveStrike, numberCriteria } from './shared.mjs';

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const STRIKE = /<\/?(del|s|strike)(\s[^>]*)?>/gi;
const LINE_BREAK = /<br\s*\/?>/gi;

/** Decodes named and numeric HTML entities. */
export function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (all, name) => (name.toLowerCase() in ENTITIES ? ENTITIES[name.toLowerCase()] : all));
}

/**
 * Replaces every issue-link macro rendered by Jira (`<span class="jira-issue-macro"
 * data-jira-key="WV-327">` with icon, link and status badge over several lines) by the
 * bare key: otherwise the key and the status come out on separate lines and break the
 * line of a comment that quotes the ticket.
 */
export function replaceIssueMacros(html) {
  const opening = /<span\s[^>]*class="[^"]*jira-issue-macro[^"]*"[^>]*>/gi;
  let output = '';
  let cursor = 0;
  let m;
  while ((m = opening.exec(html)) !== null) {
    const key = (m[0].match(/data-jira-key="([^"]+)"/i) ?? [])[1] ?? plainText(html.slice(m.index, m.index + 400).replace(/<a\s[\s\S]*?>([\s\S]*?)<\/a>[\s\S]*/i, '$1'));
    // End of the macro: the </span> that closes this one, counting nested spans.
    const tags = /<(\/?)span(\s[^>]*)?>/gi;
    tags.lastIndex = opening.lastIndex;
    let depth = 1;
    let end = html.length;
    let t;
    while ((t = tags.exec(html)) !== null) {
      depth += t[1] === '/' ? -1 : 1;
      if (depth === 0) {
        end = tags.lastIndex;
        break;
      }
    }
    output += html.slice(cursor, m.index) + key;
    cursor = end;
    opening.lastIndex = end;
  }
  return output + html.slice(cursor);
}

/**
 * Removes the remaining tags and normalises whitespace (strike-through is already `~~`).
 * Line breaks of the HTML source are whitespace: only `<br>` separates lines.
 */
function plainText(fragment) {
  return decodeEntities(replaceIssueMacros(fragment).replace(STRIKE, '~~').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .replace(/~~ ~~/g, '')
    .trim();
}

/**
 * List items with their depth and own text (sub-lists excluded), in document order.
 * `ordered` tells whether the item sits in an `<ol>`.
 */
function listItems(html) {
  const items = [];
  const stack = []; // open lists: { ordered, counter }
  const pattern = /<(\/?)(ul|ol|li)(\s[^>]*)?>/gi;
  let m;
  while ((m = pattern.exec(html)) !== null) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'li') {
      if (closing) continue;
      // Own text: up to the next list tag (opening or closing).
      const rest = html.slice(pattern.lastIndex);
      const end = rest.search(/<\/?(ul|ol|li)(\s[^>]*)?>/i);
      const raw = end === -1 ? rest : rest.slice(0, end);
      const list = stack[stack.length - 1] ?? { ordered: false, counter: 0 };
      list.counter += 1;
      items.push({ depth: Math.max(stack.length - 1, 0), ordered: list.ordered, number: list.counter, raw });
    } else if (closing) {
      stack.pop();
    } else {
      stack.push({ ordered: tag === 'ol', counter: 0 });
    }
  }
  return items;
}

/** Lines of a fragment: `<br>` separates, each line is cleaned, empty ones are dropped. */
function lines(fragment) {
  return fragment
    .split(LINE_BREAK)
    .map((l) => plainText(l))
    .filter((l) => l.length > 0);
}

/** Rendered HTML → text: paragraphs separated by a blank line, lists indented. */
export function htmlToText(html) {
  if (!html) return '';
  const source = String(html);
  const blocks = [];
  // Non-list blocks (p, h*, pre, div, td…) and lists, in order of appearance.
  const pattern = /<(p|h[1-6]|pre|div|td|th)(\s[^>]*)?>([\s\S]*?)<\/\1>|<(ul|ol)(\s[^>]*)?>[\s\S]*?<\/\4>(?![\s\S]*?<\/(ul|ol)>)/gi;
  let last = 0;
  let m;
  const pushFree = (fragment) => {
    const l = lines(fragment);
    if (l.length) blocks.push({ kind: 'block', text: l.join('\n') });
  };
  while ((m = pattern.exec(source)) !== null) {
    pushFree(source.slice(last, m.index));
    last = pattern.lastIndex;
    if (m[4]) {
      for (const item of listItems(m[0])) {
        const l = lines(item.raw);
        if (l.length === 0) continue;
        const prefix = '  '.repeat(item.depth) + (item.ordered ? `${item.number}. ` : '- ');
        blocks.push({ kind: 'item', text: prefix + l.join('\n') });
      }
    } else {
      pushFree(m[3]);
    }
  }
  pushFree(source.slice(last));

  const output = [];
  let previous = null;
  for (const block of blocks) {
    if (previous === null) output.push(block.text);
    else if (block.kind === 'item' && previous === 'item') output.push('\n' + block.text);
    else output.push('\n\n' + block.text);
    previous = block.kind;
  }
  return output.join('');
}

/** A fragment is "struck" when all its visible text sits inside a `<del>`/`<s>`. */
function criterionFrom(fragment) {
  const visible = plainText(fragment);
  const outsideStrike = plainText(fragment.replace(/<(del|s|strike)(\s[^>]*)?>[\s\S]*?<\/\1>/gi, ''));
  return resolveStrike(visible, outsideStrike);
}

/**
 * Acceptance criteria of a rendered description.
 *
 * With lists: one criterion per item (`<li>`), sub-items included, each with its own
 * text. Without a list: one line per paragraph (and per `<br>`), dropping a leading
 * intent sentence ("En tant que …", "As a …"). A criterion is "struck" when all its
 * text is; a partial strike stays visible as `~~…~~`.
 */
export function extractCriteriaFromHtml(html) {
  if (!html) return [];
  const source = String(html);
  let fragments = listItems(source).map((i) => i.raw);
  if (fragments.length === 0) {
    const paragraphs = [...source.matchAll(/<p(\s[^>]*)?>([\s\S]*?)<\/p>/gi)].map((m) => m[2]).filter((p) => plainText(p).length > 0);
    if (paragraphs.length > 0 && /^\s*(<[^>]+>\s*)*(en tant que|as a)\b/i.test(paragraphs[0].replace(STRIKE, ''))) paragraphs.shift();
    fragments = paragraphs.flatMap((p) => p.split(LINE_BREAK));
  }
  return numberCriteria(fragments.map(criterionFrom));
}
