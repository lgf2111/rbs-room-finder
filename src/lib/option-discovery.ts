/*
 * src/lib/option-discovery.ts
 *
 * Defect C: filter lists can be empty on the real page even though the same
 * build worked against the stubs. The user saw the Building dropdown with only
 * its placeholder and the Type dropdown with only "All rooms".
 *
 * The real page differs from the stubs in two ways we must tolerate:
 *   1. the concrete options are not on the documented id (#building /
 *      #resourceType) — they live on a differently-named select, or inside a
 *      select2-style wrapper that mirrors a hidden <select>;
 *   2. the options are populated by a cascade that only fires after a `change`
 *      on a parent control.
 *
 * So option discovery reads from EVERY plausible source in order, merges by
 * value (keeping order, de-duplicating, dropping only true placeholders), and —
 * when a source yields zero real options — dispatches a real `change` on the
 * native control and re-reads after a short delay. When a list is STILL empty
 * it self-reports: a compact diagnostics line in the UI and a console.info line
 * prefixed [rbs-diag], so a single screenshot identifies the real source.
 *
 * Read-only w.r.t. option values; the only mutation is dispatching `change` on
 * the native control to nudge a cascade-driven app, which is what a user doing
 * it by hand would trigger.
 */

export interface DiscoveredOption {
  value: string;
  text: string;
}

export interface Diagnostics {
  /** The documented id we tried first (e.g. "building"). */
  id: string;
  /** Tag name of the element we read (e.g. "SELECT"), or "none" if absent. */
  tag: string;
  /** Number of real (non-placeholder) options found. */
  count: number;
  /** The first few option texts, for the screenshot. */
  sampleTexts: string[];
  /** Which source actually produced the options, for debugging. */
  source: string;
}

export interface DiscoveryResult {
  options: DiscoveredOption[];
  /** Present only when the list is STILL empty after every source + a nudge. */
  diagnostics?: Diagnostics;
}

/** Is this option text a placeholder we should drop (never a real choice)? */
function isPlaceholder(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return true;
  if (/^-+$/.test(t)) return true; // dashed separator
  if (/please\s*select/i.test(t)) return true;
  if (/^resource\s*type$/i.test(t)) return true;
  if (/^all\s+buildings$/i.test(t)) return true;
  if (/^all\s+campus$/i.test(t)) return true;
  if (/^select(\s|$)/i.test(t)) return true;
  return false;
}

/** Read concrete (non-placeholder) options from a native <select>. */
function readSelectOptions(sel: HTMLSelectElement): DiscoveredOption[] {
  const out: DiscoveredOption[] = [];
  const opts = sel.options ? Array.from(sel.options) : [];
  for (const o of opts) {
    const text = (o.textContent || '').trim();
    if (isPlaceholder(text)) continue;
    out.push({ value: o.value ?? '', text });
  }
  return out;
}

/**
 * Read options that a select2-style wrapper mirrors from a hidden <select>.
 * select2 renders <li> results carrying the option text (and often a data-value
 * or id that echoes the underlying option). We read the rendered result items
 * and recover their text; the value is matched back to the hidden select when
 * possible, else falls back to the text.
 */
function readSelect2Options(root: ParentNode): DiscoveredOption[] {
  const out: DiscoveredOption[] = [];
  try {
    const items = root.querySelectorAll(
      '.select2-results__option, li[role="option"], .select2-selection__rendered [data-value]'
    );
    items.forEach((it) => {
      const el = it as HTMLElement;
      const text = (el.textContent || '').trim();
      if (isPlaceholder(text)) return;
      const value = el.getAttribute('data-value') || el.getAttribute('data-select2-id') || text;
      out.push({ value, text });
    });
  } catch {
    /* ignore */
  }
  return out;
}

/** Merge option lists by value, keeping first-seen order, de-duplicating. */
function mergeByValue(lists: DiscoveredOption[][]): DiscoveredOption[] {
  const seen = new Set<string>();
  const out: DiscoveredOption[] = [];
  for (const list of lists) {
    for (const o of list) {
      const key = o.value || o.text;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(o);
    }
  }
  return out;
}

/** Collect every select whose id or name case-insensitively contains `word`. */
function selectsMatching(word: string, exceptId: string): HTMLSelectElement[] {
  const re = new RegExp(word, 'i');
  const all = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[];
  return all.filter((s) => {
    if (s.id === exceptId) return false;
    return re.test(s.id || '') || re.test(s.getAttribute('name') || '');
  });
}

/**
 * Discover options for a logical filter (building / room type) from every
 * plausible source, merged. `id` is the documented element id; `words` are the
 * name/id fragments that identify sibling selects (e.g. ["building"] or
 * ["resourcetype","type"]).
 */
export function discoverOptions(id: string, words: string[]): DiscoveryResult {
  const lists: DiscoveredOption[][] = [];
  const documented = document.getElementById(id) as HTMLSelectElement | null;
  const tag = documented ? documented.tagName : 'none';

  // 1) the documented id.
  if (documented && documented.options) lists.push(readSelectOptions(documented));

  // 2) any select whose name/id matches one of the words.
  const matched = new Set<HTMLSelectElement>();
  for (const w of words) for (const s of selectsMatching(w, id)) matched.add(s);
  for (const s of matched) lists.push(readSelectOptions(s));

  // 3) a select2-style wrapper near the documented control (or anywhere).
  if (documented && documented.parentElement) {
    lists.push(readSelect2Options(documented.parentElement));
  }
  // Also scan a wrapper whose id echoes the documented id (select2 convention).
  const wrapper = document.getElementById(`select2-${id}-container`)?.closest('.select2');
  if (wrapper) lists.push(readSelect2Options(wrapper));

  const options = mergeByValue(lists);

  const result: DiscoveryResult = { options };
  if (options.length === 0) {
    result.diagnostics = {
      id,
      tag,
      count: 0,
      sampleTexts: [],
      source: 'none',
    };
  }
  return result;
}

/**
 * Nudge a cascade-driven app to populate a control: dispatch a REAL `change`
 * (and `input`) event on the documented native control, so an app that only
 * fills the list on a parent change has a chance to do so. Safe no-op when the
 * control is absent.
 */
export function nudgeNativeControl(id: string): void {
  try {
    const el = document.getElementById(id);
    if (!el) return;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } catch {
    /* non-fatal */
  }
}

/** Emit the diagnostics line to the console (prefixed so it is greppable). */
export function logDiagnostics(label: string, d: Diagnostics): void {
  try {
    // eslint-disable-next-line no-console
    console.info(
      `[rbs-diag] ${label}: id=#${d.id} tag=${d.tag} count=${d.count} sample=[${d.sampleTexts.join(', ')}]`
    );
  } catch {
    /* ignore */
  }
}
