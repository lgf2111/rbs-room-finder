/*
 * src/lib/page-content.ts
 *
 * Progressive-enhancement re-render of the RBS static pages (User Guide, FAQ,
 * Support) and a parser for the Support Booking reservations table.
 *
 * We do NOT duplicate the page content: we fetch the SAME-ORIGIN page HTML,
 * parse it with DOMParser (an inert document — scripts in a DOMParser document
 * never execute), extract the main content, and SANITISE it before nova renders
 * it on the dark surface. Sanitising means: drop <script>/<style>/<iframe>/
 * <link>/<object>/<embed>, strip every on* handler attribute and javascript:
 * URLs, and drop absolute/fixed-positioned "chrome". Nothing from the fetched
 * page is ever executed and no raw HTML string is inserted — React renders the
 * cleaned node tree as React elements.
 *
 * No remote URLs: the fetch is same-origin (relative path), cache: 'no-store'.
 */

/** Tags that must never survive sanitising (executable or layout chrome). */
const DROP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'IFRAME',
  'LINK',
  'OBJECT',
  'EMBED',
  'NOSCRIPT',
  'META',
  'BASE',
]);

/** A minimal, serialisable node tree React can render without raw HTML. */
export type CleanNode =
  | { type: 'text'; text: string }
  | { type: 'element'; tag: string; children: CleanNode[] };

/** Tags we keep (an allow-list of safe, content-only elements). */
const KEEP_TAGS = new Set([
  'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'ASIDE',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'P', 'SPAN', 'STRONG', 'EM', 'B', 'I', 'U', 'SMALL', 'CODE', 'PRE', 'BLOCKQUOTE',
  'UL', 'OL', 'LI', 'DL', 'DT', 'DD',
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION',
  'BR', 'HR', 'FIGURE', 'FIGCAPTION',
]);

function isAbsolutelyPositioned(el: Element): boolean {
  const style = (el.getAttribute('style') || '').toLowerCase();
  return /position\s*:\s*(absolute|fixed|sticky)/.test(style);
}

/** Recursively convert a DOM node into a CleanNode tree, dropping unsafe bits. */
function clean(node: Node): CleanNode | null {
  if (node.nodeType === 3 /* text */) {
    const text = node.nodeValue || '';
    return text.trim() === '' && !/\s/.test(text) ? null : { type: 'text', text };
  }
  if (node.nodeType !== 1 /* element */) return null;
  const el = node as Element;
  const tag = el.tagName.toUpperCase();
  if (DROP_TAGS.has(tag)) return null;
  if (isAbsolutelyPositioned(el)) return null;
  // Unknown tags: skip the wrapper but keep sanitised children (unwrap).
  const keep = KEEP_TAGS.has(tag);
  const children: CleanNode[] = [];
  el.childNodes.forEach((c) => {
    const cleaned = clean(c);
    if (cleaned) children.push(cleaned);
  });
  if (!keep) {
    // Unwrap: represent as a plain container so no unknown/anchoring tag (e.g.
    // <a>, <nav>, <button>) carries over on* handlers or navigation.
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    return { type: 'element', tag: 'div', children };
  }
  return { type: 'element', tag: tag.toLowerCase(), children };
}

/** Pick the main content container: prefer <main>, else the densest-text block. */
function pickMain(doc: Document): Element | null {
  const main = doc.querySelector('main');
  if (main) return main;
  const content = doc.getElementById('content');
  if (content) return content;
  // Fallback: the element with the most text content under <body>.
  const body = doc.body;
  if (!body) return null;
  let best: Element | null = body;
  let bestLen = (body.textContent || '').length;
  body.querySelectorAll('div, section, article').forEach((el) => {
    const len = (el.textContent || '').length;
    if (len > bestLen * 0.6 && el.children.length >= 1 && len <= bestLen) {
      // prefer a tighter container with nearly all the text
      if (len > (best === body ? 0 : bestLen)) {
        best = el;
        bestLen = len;
      }
    }
  });
  return best;
}

export interface FetchedContent {
  title: string;
  nodes: CleanNode[];
}

/**
 * Fetch a same-origin page and return its sanitised main content as a CleanNode
 * tree. Throws on network/parse failure or when no content container is found,
 * so the caller can render an honest error state + reveal-native control.
 */
export async function fetchPageContent(path: string): Promise<FetchedContent> {
  const resp = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
  if (!resp.ok) throw new Error(`fetch failed (HTTP ${resp.status})`);
  const html = await resp.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const main = pickMain(doc);
  if (!main) throw new Error('no content container found');
  const title = (doc.querySelector('title')?.textContent || '').trim();
  const nodes: CleanNode[] = [];
  main.childNodes.forEach((c) => {
    const cleaned = clean(c);
    if (cleaned) nodes.push(cleaned);
  });
  if (nodes.length === 0) throw new Error('content was empty after sanitising');
  return { title, nodes };
}

// --- Support Booking reservations table ------------------------------------

export interface ReservationRow {
  id: string;
  room: string;
  date: string;
  time: string;
  status: string;
}

/**
 * Fetch and parse the Support Booking reservations table (#bookingList rows).
 * Returns one ReservationRow per data row. Never executes page scripts (inert
 * DOMParser document). Throws on network/parse failure.
 */
export async function fetchReservations(path: string): Promise<ReservationRow[]> {
  const resp = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
  if (!resp.ok) throw new Error(`fetch failed (HTTP ${resp.status})`);
  const html = await resp.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.getElementById('bookingList');
  if (!table) return [];
  const rows: ReservationRow[] = [];
  table.querySelectorAll('tr[data-booking-id]').forEach((tr) => {
    const cells = Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim());
    if (cells.length < 4) return;
    rows.push({
      id: tr.getAttribute('data-booking-id') || '',
      room: cells[0],
      date: cells[1],
      time: cells[2],
      status: cells[3],
    });
  });
  return rows;
}
