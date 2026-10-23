/*
 * content/panel.js
 *
 * The RBS Room Finder content script UI.
 *
 * Responsibilities:
 *   - On /SRB001/SRB001Page: inject a floating search panel inside a SHADOW
 *     ROOT so WebForms CSS can't leak in and ours can't leak out.
 *   - On other rbs.singaporetech.edu.sg pages: inject only a small launcher
 *     button linking to /SRB001/SRB001Page.
 *   - Drive the native WebForms controls using buildSearchPlan() output, obeying
 *     the 1200 ms settle + re-read-before-click + re-read-after-render rules.
 *   - Parse the re-rendered DOM with parseResults() and render result cards.
 *   - Remember the last search in chrome.storage.local and restore it.
 *
 * Pure helpers (parseResults, buildSearchPlan, formatDate, ...) come from
 * content/native.js, which is loaded first and exposes them on globalThis.
 *
 * Hard rules from the page contract are enforced here. Do not weaken them.
 */

(function () {
  'use strict';

  const SEARCH_PATH = '/SRB001/SRB001Page';
  const STORAGE_KEY = 'rbsLastSearch';

  const N = globalThis.RBS_NATIVE || globalThis;
  const {
    RBS_CONTROL_IDS,
    POSTBACK_SETTLE_MS,
    RESULTS_POLL_TIMEOUT_MS,
    RESULTS_POLL_INTERVAL_MS,
    formatDate,
    formatWindow,
    buildSearchPlan,
    parseResults,
    filterAndSortRooms,
    classifyEmpty,
    hasNoResultsText,
    resultsSignature,
    pollForResults,
  } = N;

  // Guard: if native.js failed to load, do nothing rather than throw on page.
  if (typeof buildSearchPlan !== 'function' || typeof parseResults !== 'function') {
    return;
  }

  // ---- utilities ------------------------------------------------------------

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isSearchPage() {
    return location.pathname.indexOf(SEARCH_PATH) !== -1;
  }

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'for') node.htmlFor = v;
        else if (k.startsWith('on') && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v != null) {
          node.setAttribute(k, v);
        }
      }
    }
    if (children) {
      for (const c of [].concat(children)) {
        if (c == null) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  // Half-hour steps 07:00 .. 22:30
  function buildTimeOptions() {
    const out = [];
    for (let m = 7 * 60; m <= 22 * 60 + 30; m += 30) {
      const h = String(Math.floor(m / 60)).padStart(2, '0');
      const mm = String(m % 60).padStart(2, '0');
      out.push(`${h}:${mm}`);
    }
    return out;
  }

  // Today + next 7 days as { value: "22 Oct 2026", label: "..." }
  function buildDateOptions() {
    const out = [];
    const now = new Date();
    for (let i = 0; i <= 7; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      out.push({ value: formatDate(d), label: i === 0 ? `${formatDate(d)} (today)` : formatDate(d) });
    }
    return out;
  }

  // Read the option TEXTs from the native #resourceType select.
  function readRoomTypes() {
    const sel = document.getElementById(RBS_CONTROL_IDS.resourceType);
    if (!sel) return [];
    return Array.from(sel.options)
      .map((o) => (o.textContent || '').trim())
      .filter((t) => t && !/^-+$/.test(t) && !/please select/i.test(t));
  }

  // Which required native ids are missing?
  //
  // Gate on ALL of these. The My Bookings page (/DHB001/DHB001Page) also has
  // #resourceType, #searchSlotDate and #bookingstatus but NOT the time selects
  // or the main search button, so a partial check would put a dead panel there.
  // We deliberately do NOT include #bookingstatus in the gate (it exists on
  // pages that are not the search page); the time selects + search button are
  // the distinguishing ids.
  function missingControlIds() {
    const required = [
      RBS_CONTROL_IDS.resourceType, // resourceType
      RBS_CONTROL_IDS.date, // searchSlotDate
      RBS_CONTROL_IDS.start, // SearchHoursFrom
      RBS_CONTROL_IDS.end, // SearchHoursTo
      RBS_CONTROL_IDS.searchButton, // btnBookingMainSearch
    ];
    return required.filter((id) => !document.getElementById(id));
  }

  // ---- native driving (obeys the hard rules) --------------------------------

  function fireChange(node) {
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Set a <select> to the option whose trimmed TEXT === wantText. Returns true
  // if a matching option existed and is now selected.
  function selectByText(selectEl, wantText) {
    const want = String(wantText).trim();
    for (const opt of Array.from(selectEl.options)) {
      if ((opt.textContent || '').trim() === want) {
        if (selectEl.value !== opt.value) {
          selectEl.value = opt.value;
          fireChange(selectEl);
        }
        return true;
      }
    }
    return false;
  }

  function setText(inputEl, value) {
    if (inputEl.value !== value) {
      inputEl.value = value;
      fireChange(inputEl);
    }
    return true;
  }

  // Apply one mutation. Returns true on success.
  function applyMutation(mut) {
    const node = document.getElementById(mut.id);
    if (!node) return false;
    if (mut.kind === 'select-by-text') return selectByText(node, mut.value);
    if (mut.kind === 'set-text') return setText(node, mut.value);
    return false;
  }

  // Verify the current native values match the plan's mutations.
  // Returns an array of mismatched mutations (empty === all good).
  function verifyMutations(mutations) {
    const bad = [];
    for (const mut of mutations) {
      const node = document.getElementById(mut.id);
      if (!node) {
        bad.push(mut);
        continue;
      }
      let current;
      if (mut.kind === 'select-by-text') {
        const sel = node.options[node.selectedIndex];
        current = sel ? (sel.textContent || '').trim() : '';
      } else {
        current = node.value;
      }
      if (current !== String(mut.value).trim()) bad.push(mut);
    }
    return bad;
  }

  // Read a snapshot of the live results region for pollForResults().
  function readResultsSnapshot() {
    const cards = Array.from(document.querySelectorAll('.resourceName'));
    const names = cards.map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim());
    const bodyText = document.body ? document.body.textContent || '' : '';
    const btn = document.getElementById(RBS_CONTROL_IDS.searchButton);
    return {
      cardCount: cards.length,
      names,
      noResults: hasNoResultsText(bodyText),
      readyComplete: document.readyState === 'complete',
      searchDisabled: !!(btn && btn.disabled),
    };
  }

  // The HTML to parse: prefer the results container (nearest common ancestor of
  // the .resourceName cards), else the whole body.
  function resultsHtml() {
    const cards = Array.from(document.querySelectorAll('.resourceName'));
    if (cards.length === 0) {
      return document.body ? document.body.innerHTML : '';
    }
    // Walk up from the first card until an ancestor contains ALL cards.
    let node = cards[0];
    while (node && node.parentElement) {
      const parent = node.parentElement;
      if (cards.every((c) => parent.contains(c))) {
        // One more level up is usually the list wrapper; this parent already
        // contains every card, so it is a safe, tight container.
        return parent.innerHTML;
      }
      node = parent;
    }
    return document.body ? document.body.innerHTML : '';
  }

  // Drive all controls with the settle + re-read-before-click rules, then click
  // Search and POLL for the re-render (a fixed sleep is both too short for a
  // slow postback and wasteful on a fast one). Capture HTML AFTER the wait.
  //
  // @returns {Promise<{trusted, mismatched, html, rowCount, waitedMs, timedOut,
  //                    rendered, emptyConfirmed, reason}>}
  async function runNativeSearch(plan, onProgress) {
    // 1. Apply each mutation, waiting POSTBACK_SETTLE_MS after each (rule 1).
    for (let i = 0; i < plan.mutations.length; i++) {
      const mut = plan.mutations[i];
      if (onProgress) onProgress(`Setting ${mut.id}\u2026`);
      applyMutation(mut);
      await sleep(plan.settleMs);
    }

    // 2. Re-read all values before clicking. If a postback was still in flight,
    //    the selects silently reset; set them again, then settle (rule 2).
    let mismatched = verifyMutations(plan.mutations);
    if (mismatched.length) {
      if (onProgress) onProgress('Re-applying values that reset\u2026');
      for (const mut of mismatched) {
        applyMutation(mut);
        await sleep(plan.settleMs);
      }
      mismatched = verifyMutations(plan.mutations);
      // Only click if the window is now correct (rule 2).
      if (mismatched.length) {
        return { trusted: false, mismatched, html: null, rowCount: 0, reason: 'controls reset' };
      }
    }

    // 3. Take a pre-click signature so we can detect a genuine re-render.
    const preSig = resultsSignature(readResultsSnapshot());

    const btn = document.getElementById(RBS_CONTROL_IDS.searchButton);
    if (!btn) {
      return {
        trusted: false,
        mismatched: [{ id: RBS_CONTROL_IDS.searchButton }],
        html: null,
        rowCount: 0,
        reason: 'search button missing',
      };
    }
    if (onProgress) onProgress('Searching \u2014 waiting for RBS to render\u2026');
    btn.click();

    // 4. Poll (up to 15 s) for the results to actually re-render. A zero-row
    //    read is only trusted if the no-results marker is really present after
    //    the page finishes; otherwise it is a too-early read (untrusted).
    const poll = await pollForResults({
      read: readResultsSnapshot,
      now: () => Date.now(),
      sleep: (ms) => sleep(ms),
      preSignature: preSig,
      timeoutMs: RESULTS_POLL_TIMEOUT_MS,
      pollMs: RESULTS_POLL_INTERVAL_MS,
    });

    const secs = (poll.waitedMs / 1000).toFixed(1);
    if (onProgress) {
      onProgress(`Searching \u2014 waiting for RBS to render (took ${secs} s)`);
    }

    if (poll.timedOut) {
      return {
        trusted: false,
        mismatched: [],
        html: null,
        rowCount: 0,
        waitedMs: poll.waitedMs,
        timedOut: true,
        rendered: false,
        emptyConfirmed: false,
        reason: 'results never rendered',
      };
    }

    // 5. Re-read the selectors; they must still show the requested window,
    //    otherwise the result answers a different question (rule 3).
    const afterMismatch = verifyMutations(plan.mutations);
    const html = resultsHtml();
    const rooms = parseResults(html);

    return {
      trusted: afterMismatch.length === 0,
      mismatched: afterMismatch,
      html,
      rowCount: rooms.length,
      waitedMs: poll.waitedMs,
      timedOut: false,
      rendered: poll.rendered,
      emptyConfirmed: poll.emptyConfirmed,
      reason: afterMismatch.length === 0 ? null : 'controls drifted after render',
    };
  }

  // Ids / text that must NEVER be clicked by us (they commit a booking).
  const FORBIDDEN_CLICK_IDS = ['btnBookingSave', 'btnBookingNext', 'btnBookingMainClear'];

  // How long to wait for the "N Facility Selected" badge after a card click.
  const SELECT_CONFIRM_MS = 2000;

  // Find the card element for a given room code. The live shape is a Bootstrap
  // card containing a `div.resourceName` whose text is "NAME/TYPE". We match the
  // card whose resourceName starts with the room code.
  function findRoomCard(roomCode) {
    const code = String(roomCode).trim();
    const names = Array.from(document.querySelectorAll('.resourceName'));
    for (const nameEl of names) {
      const txt = (nameEl.textContent || '').replace(/\s+/g, ' ').trim();
      const before = txt.split('/')[0].trim();
      if (before === code || txt.indexOf(code) === 0) {
        // The clickable card is the nearest card ancestor (fall back to a row
        // or the name element's container).
        return (
          nameEl.closest('.card-body') ||
          nameEl.closest('.card') ||
          nameEl.closest('.row') ||
          nameEl.parentElement ||
          nameEl
        );
      }
    }
    return null;
  }

  // True if the page currently shows a "N Facility Selected" badge.
  function hasSelectionBadge() {
    const all = document.body ? document.body.textContent || '' : '';
    return /\d+\s+Facilit(?:y|ies)\s+Selected/i.test(all);
  }

  // Scroll the native action bar / selection badge into view (whichever exists)
  // so the user can see the real Book control. Never clicks it.
  function scrollActionBarIntoView() {
    const save = document.getElementById('btnBookingSave');
    const next = document.getElementById('btnBookingNext');
    let anchor = save || next || null;
    if (!anchor) {
      // Find the element carrying the selection badge text.
      const candidates = Array.from(
        document.querySelectorAll('span, div, button, a, label')
      );
      anchor = candidates.find((n) =>
        /\d+\s+Facilit(?:y|ies)\s+Selected/i.test((n.textContent || '').trim())
      );
    }
    if (anchor && typeof anchor.scrollIntoView === 'function') {
      anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // Select a room by CLICKING its card (the live site has no checkbox), then
  // bring the native action bar into view. NEVER clicks Book/Next/Clear or any
  // submit. Resolves {ok, reason}; ok is true only if the selection badge
  // appeared within SELECT_CONFIRM_MS.
  async function selectRoom(roomCode) {
    const card = findRoomCard(roomCode);
    if (!card) {
      return { ok: false, reason: 'card-not-found' };
    }

    // Guard: never dispatch a click on a forbidden submit control.
    const forbidden = FORBIDDEN_CLICK_IDS.some(
      (id) => card.id === id || card.querySelector('#' + id) === card
    );
    if (forbidden) {
      return { ok: false, reason: 'refused-forbidden-target' };
    }

    card.scrollIntoView({ behavior: 'smooth', block: 'center' });

    card.click();

    // Poll for the "N Facility Selected" badge for up to SELECT_CONFIRM_MS.
    // The badge appearing is our only trusted confirmation the click took.
    const deadline = Date.now() + SELECT_CONFIRM_MS;
    while (Date.now() < deadline) {
      await sleep(150);
      if (hasSelectionBadge()) {
        scrollActionBarIntoView();
        return { ok: true };
      }
    }
    return { ok: false, reason: 'no-badge' };
  }

  // ---- storage --------------------------------------------------------------

  function loadLastSearch() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([STORAGE_KEY], (res) => {
          resolve((res && res[STORAGE_KEY]) || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function loadDefaultType() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(['rbsDefaultType'], (res) => {
          resolve((res && res.rbsDefaultType) || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function saveLastSearch(search) {
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: search });
    } catch (e) {
      /* storage unavailable; non-fatal */
    }
  }

  // ---- panel UI -------------------------------------------------------------

  // The panel's own CSS, embedded so it lives inside the shadow root without
  // needing web_accessible_resources. Kept in sync with content/panel.css.
  const PANEL_CSS = `
:host{all:initial}
*,*::before,*::after{box-sizing:border-box}
.rbs-panel{position:fixed;top:84px;right:20px;width:340px;max-height:calc(100vh - 120px);display:flex;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.4;color:#1f2933;background:#fff;border:1px solid #d6dde5;border-radius:12px;box-shadow:0 10px 30px rgba(16,24,40,.18);z-index:2147483000;overflow:hidden}
.rbs-panel.rbs-collapsed .rbs-body{display:none}
.rbs-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;background:linear-gradient(135deg,#1b4965,#2a6f97);color:#fff;cursor:move}
.rbs-title{font-weight:600;font-size:14px;letter-spacing:.2px}
.rbs-header-actions{display:flex;gap:6px}
.rbs-icon-btn{appearance:none;border:none;background:rgba(255,255,255,.16);color:#fff;width:24px;height:24px;border-radius:6px;cursor:pointer;font-size:14px;line-height:1;display:inline-flex;align-items:center;justify-content:center}
.rbs-icon-btn:hover{background:rgba(255,255,255,.3)}
.rbs-body{padding:12px 14px;overflow-y:auto}
.rbs-field{margin-bottom:10px}
.rbs-field label{display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:#52606d;margin-bottom:4px}
.rbs-field select,.rbs-field input{width:100%;padding:7px 9px;border:1px solid #cbd2d9;border-radius:8px;background:#fff;color:#1f2933;font-size:13px}
.rbs-field select:focus,.rbs-field input:focus{outline:2px solid #2a6f97;outline-offset:0;border-color:#2a6f97}
.rbs-row{display:flex;gap:8px}
.rbs-row .rbs-field{flex:1}
.rbs-reuse{display:none;align-items:center;gap:6px;margin-bottom:10px}
.rbs-reuse.rbs-visible{display:flex}
.rbs-chip{appearance:none;border:1px solid #a7c4d8;background:#eaf3f9;color:#1b4965;border-radius:999px;padding:5px 11px;font-size:12px;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rbs-chip:hover{background:#d8e9f4}
.rbs-search-btn{appearance:none;width:100%;border:none;background:#2a6f97;color:#fff;font-weight:600;font-size:14px;padding:10px;border-radius:9px;cursor:pointer;margin-top:2px}
.rbs-search-btn:hover{background:#1b4965}
.rbs-search-btn:disabled{background:#9fb3c0;cursor:progress}
.rbs-caveat{font-size:11px;color:#6b7785;margin:10px 0 4px}
.rbs-status{margin-top:10px;padding:9px 10px;border-radius:8px;font-size:12px;background:#f1f5f8;color:#3e4c59;display:none}
.rbs-status.rbs-visible{display:block}
.rbs-status.rbs-error{background:#fdecea;color:#8a1c13}
.rbs-status.rbs-warn{background:#fff6e5;color:#8a5a00}
.rbs-status.rbs-info{background:#eaf3f9;color:#1b4965}
.rbs-results{margin-top:10px;display:flex;flex-direction:column;gap:8px}
.rbs-card{border:1px solid #dbe2ea;border-radius:10px;padding:10px 11px;background:#fff;display:flex;align-items:center;justify-content:space-between;gap:8px}
.rbs-card-main{min-width:0}
.rbs-card-name{font-weight:600;font-size:13px;color:#1f2933;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rbs-card-meta{font-size:11px;color:#6b7785;margin-top:2px}
.rbs-cap-pill{display:inline-block;background:#eaf3f9;color:#1b4965;border-radius:999px;padding:1px 8px;font-weight:600;margin-right:6px}
.rbs-book-btn{appearance:none;border:1px solid #2a6f97;background:#fff;color:#2a6f97;font-weight:600;font-size:12px;padding:6px 12px;border-radius:8px;cursor:pointer;flex:none}
.rbs-book-btn:hover{background:#2a6f97;color:#fff}
.rbs-book-note{margin-top:8px;padding:9px 10px;border-radius:8px;background:#fff6e5;color:#8a5a00;font-size:12px;display:none}
.rbs-book-note.rbs-visible{display:block}
.rbs-book-note.rbs-error{background:#fdecea;color:#8a1c13}
.rbs-launcher{position:fixed;bottom:22px;right:22px;z-index:2147483000;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.rbs-launcher a{display:inline-flex;align-items:center;gap:8px;background:#2a6f97;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 16px;border-radius:999px;box-shadow:0 8px 22px rgba(16,24,40,.22)}
.rbs-launcher a:hover{background:#1b4965}
`;

  let ui = null; // references to live nodes

  function buildPanel(shadow, roomTypes) {
    const dateOptions = buildDateOptions();
    const timeOptions = buildTimeOptions();

    const typeSelect = el('select', { id: 'rbs-type' });
    for (const t of roomTypes) typeSelect.appendChild(el('option', { value: t, text: t }));

    const dateSelect = el('select', { id: 'rbs-date' });
    for (const d of dateOptions) dateSelect.appendChild(el('option', { value: d.value, text: d.label }));

    const startSelect = el('select', { id: 'rbs-start' });
    for (const t of timeOptions) startSelect.appendChild(el('option', { value: t, text: t }));

    const endSelect = el('select', { id: 'rbs-end' });
    for (const t of timeOptions) endSelect.appendChild(el('option', { value: t, text: t }));
    // sensible defaults: 09:00 -> 11:00
    if (timeOptions.includes('09:00')) startSelect.value = '09:00';
    if (timeOptions.includes('11:00')) endSelect.value = '11:00';

    const capInput = el('input', { id: 'rbs-cap', type: 'number', min: '0', step: '1', value: '0' });

    const reuseChip = el('button', { class: 'rbs-chip', title: 'Reuse last search' });
    const reuseWrap = el('div', { class: 'rbs-reuse' }, [reuseChip]);

    const searchBtn = el('button', { class: 'rbs-search-btn', text: 'Search' });

    const statusBox = el('div', { class: 'rbs-status' });
    const resultsBox = el('div', { class: 'rbs-results' });
    const bookNote = el('div', { class: 'rbs-book-note' });

    const body = el('div', { class: 'rbs-body' }, [
      reuseWrap,
      el('div', { class: 'rbs-field' }, [el('label', { text: 'Room type' }), typeSelect]),
      el('div', { class: 'rbs-field' }, [el('label', { text: 'Date' }), dateSelect]),
      el('div', { class: 'rbs-row' }, [
        el('div', { class: 'rbs-field' }, [el('label', { text: 'Start' }), startSelect]),
        el('div', { class: 'rbs-field' }, [el('label', { text: 'End' }), endSelect]),
      ]),
      el('div', { class: 'rbs-field' }, [el('label', { text: 'Min capacity' }), capInput]),
      searchBtn,
      el('div', { class: 'rbs-caveat', text: '\u201CAvailable\u201D means free for the entire window you pick.' }),
      statusBox,
      bookNote,
      resultsBox,
    ]);

    const collapseBtn = el('button', { class: 'rbs-icon-btn', title: 'Collapse', text: '\u2013' });
    const header = el('div', { class: 'rbs-header' }, [
      el('span', { class: 'rbs-title', text: 'RBS Room Finder' }),
      el('div', { class: 'rbs-header-actions' }, [collapseBtn]),
    ]);

    const panel = el('div', { class: 'rbs-panel' }, [header, body]);

    collapseBtn.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('rbs-collapsed');
      collapseBtn.textContent = collapsed ? '+' : '\u2013';
      collapseBtn.title = collapsed ? 'Expand' : 'Collapse';
    });

    makeDraggable(panel, header);

    const style = el('style', { text: PANEL_CSS });
    shadow.appendChild(style);
    shadow.appendChild(panel);

    ui = {
      panel, typeSelect, dateSelect, startSelect, endSelect, capInput,
      searchBtn, statusBox, resultsBox, bookNote, reuseWrap, reuseChip,
    };
    return ui;
  }

  function makeDraggable(panel, handle) {
    let startX = 0, startY = 0, originLeft = 0, originTop = 0, dragging = false;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('.rbs-icon-btn')) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      panel.style.right = 'auto';
      panel.style.left = rect.left + 'px';
      panel.style.top = rect.top + 'px';
      originLeft = rect.left;
      originTop = rect.top;
      startX = e.clientX;
      startY = e.clientY;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      panel.style.left = Math.max(0, originLeft + (e.clientX - startX)) + 'px';
      panel.style.top = Math.max(0, originTop + (e.clientY - startY)) + 'px';
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  function setStatus(kind, text) {
    const box = ui.statusBox;
    box.className = 'rbs-status rbs-visible' + (kind ? ' rbs-' + kind : '');
    box.textContent = text;
  }

  function clearStatus() {
    ui.statusBox.className = 'rbs-status';
    ui.statusBox.textContent = '';
  }

  function showBookNote(kind, text) {
    ui.bookNote.className = 'rbs-book-note rbs-visible' + (kind ? ' rbs-' + kind : '');
    ui.bookNote.textContent = text;
  }

  function renderResults(rooms, windowLabel) {
    ui.resultsBox.textContent = '';
    for (const room of rooms) {
      // Display name/room code; prefer the explicit room code when present.
      const displayName = room.room || room.name;
      const bookBtn = el('button', { class: 'rbs-book-btn', text: 'Book' });
      const card = el('div', { class: 'rbs-card' }, [
        el('div', { class: 'rbs-card-main' }, [
          el('div', { class: 'rbs-card-name', text: displayName }),
          el('div', { class: 'rbs-card-meta' }, [
            el('span', { class: 'rbs-cap-pill', text: 'cap ' + room.capacity }),
            document.createTextNode('free ' + windowLabel),
          ]),
        ]),
        bookBtn,
      ]);

      bookBtn.addEventListener('click', async () => {
        bookBtn.disabled = true;
        showBookNote('', 'Selecting ' + displayName + ' on the native page\u2026');
        try {
          const res = await selectRoom(room.room || room.name);
          if (res.ok) {
            showBookNote(
              '',
              '1 Facility Selected \u2014 confirm Book below; nothing is booked ' +
                'until you click Book.'
            );
          } else if (res.reason === 'card-not-found') {
            showBookNote(
              'error',
              'Could not find ' + displayName + ' on the page. Scroll the native ' +
                'results and click the room card yourself.'
            );
          } else {
            showBookNote(
              'error',
              'The selection did not take (no “Facility Selected” badge appeared). ' +
                'Click the ' + displayName + ' card on the native page yourself.'
            );
          }
        } catch (e) {
          showBookNote('error', 'Selection failed: ' + (e && e.message ? e.message : String(e)));
        } finally {
          bookBtn.disabled = false;
        }
      });

      ui.resultsBox.appendChild(card);
    }
  }

  function readForm() {
    return {
      roomType: ui.typeSelect.value,
      date: ui.dateSelect.value,
      start: ui.startSelect.value,
      end: ui.endSelect.value,
      minCapacity: Number(ui.capInput.value) || 0,
    };
  }

  function applyForm(search, roomTypes) {
    if (!search) return;
    if (search.roomType && roomTypes.includes(search.roomType)) ui.typeSelect.value = search.roomType;
    if (search.date && Array.from(ui.dateSelect.options).some((o) => o.value === search.date)) {
      ui.dateSelect.value = search.date;
    }
    if (search.start) ui.startSelect.value = search.start;
    if (search.end) ui.endSelect.value = search.end;
    if (search.minCapacity != null) ui.capInput.value = String(search.minCapacity);
  }

  function showReuseChip(search) {
    if (!search) return;
    ui.reuseChip.textContent =
      `Reuse: ${search.roomType}, ${search.date}, ${formatWindow(search.start, search.end)}` +
      (search.minCapacity ? `, cap ${search.minCapacity}+` : '');
    ui.reuseWrap.className = 'rbs-reuse rbs-visible';
  }

  // Run a search for a given status and return parsed rooms + trust + rowCount
  // + whether the (possibly zero) read was confirmed post-render.
  async function searchOnce(form, status, onProgress) {
    const plan = buildSearchPlan({
      roomType: form.roomType,
      date: form.date,
      start: form.start,
      end: form.end,
      minCapacity: form.minCapacity,
      status,
      knownRoomTypes: readRoomTypes(),
    });
    const res = await runNativeSearch(plan, onProgress);

    if (res.timedOut) {
      return {
        trusted: false,
        timedOut: true,
        confirmed: false,
        reason: res.reason || 'results never rendered',
        rooms: [],
        rowCount: 0,
        waitedMs: res.waitedMs || 0,
      };
    }
    if (!res.trusted) {
      return {
        trusted: false,
        timedOut: false,
        confirmed: false,
        mismatched: res.mismatched,
        reason: res.reason,
        rooms: [],
        rowCount: 0,
        waitedMs: res.waitedMs || 0,
      };
    }

    const rooms = parseResults(res.html || '');
    // A zero-row read is "confirmed" only if the no-results marker rendered.
    const confirmed = rooms.length > 0 || res.emptyConfirmed === true;
    return {
      trusted: true,
      timedOut: false,
      confirmed,
      rooms,
      rowCount: rooms.length,
      minCapacity: plan.minCapacity,
      waitedMs: res.waitedMs || 0,
    };
  }

  async function onSearch() {
    let form;
    try {
      form = readForm();
      // Validate early with buildSearchPlan (throws on bad input).
      buildSearchPlan({ ...form, status: 'Available', knownRoomTypes: readRoomTypes() });
    } catch (e) {
      setStatus('error', e.message);
      return;
    }

    ui.searchBtn.disabled = true;
    ui.bookNote.className = 'rbs-book-note';
    ui.resultsBox.textContent = '';
    const windowLabel = formatWindow(form.start, form.end);

    const secs = (ms) => (Number(ms) / 1000).toFixed(1);

    try {
      setStatus('info', 'Searching \u2014 waiting for RBS to render\u2026');
      const avail = await searchOnce(form, 'Available', (p) => setStatus('info', p));

      // A read that never rendered must be reported as unconfirmed, NOT as a
      // verdict. This is the fix for the confident-wrong-answer bug.
      if (avail.timedOut) {
        setStatus('warn',
          `Could not confirm: RBS did not finish rendering within ${secs(RESULTS_POLL_TIMEOUT_MS)} s ` +
          `(waited ${secs(avail.waitedMs)} s). No verdict shown \u2014 try Search again.`);
        return;
      }
      if (!avail.trusted) {
        const ids = (avail.mismatched || []).map((m) => '#' + m.id).join(', ');
        setStatus('warn',
          'Result not trusted: the native controls reset mid-search' +
          (ids ? ' (' + ids + ')' : '') + '. Try Search again.');
        return;
      }

      const filtered = filterAndSortRooms(avail.rooms, form.minCapacity);

      if (filtered.length > 0) {
        setStatus('info',
          `${filtered.length} room(s) free for the entire window ${windowLabel} ` +
          `(rendered in ${secs(avail.waitedMs)} s).`);
        renderResults(filtered, windowLabel);
        saveLastSearch(form);
        showReuseChip(form);
        return;
      }

      // Zero available rows. Only meaningful if the empty read was confirmed by
      // the no-results marker rendering; otherwise bail out as unconfirmed.
      if (!avail.confirmed) {
        setStatus('warn',
          `Could not confirm there are no free rooms (the empty read was not verified ` +
          `after render). No verdict shown \u2014 try Search again.`);
        return;
      }

      // Distinguish "all booked" vs "no such rooms" by re-running the SAME
      // window with bookingstatus=All exactly once (rule).
      setStatus('info', 'None free \u2014 checking whether they are booked or absent\u2026');
      const all = await searchOnce(form, 'All', (p) => setStatus('info', p));

      if (all.timedOut) {
        setStatus('warn',
          `Could not confirm: the all-rooms check did not render within ` +
          `${secs(RESULTS_POLL_TIMEOUT_MS)} s. No verdict shown \u2014 try Search again.`);
        return;
      }
      if (!all.trusted) {
        setStatus('warn', 'Could not confirm (controls reset during the all-rooms check). Try again.');
        return;
      }

      const verdict = classifyEmpty({
        rowsWithAll: all.rowCount,
        rowsAvailable: avail.rowCount,
        availableConfirmed: avail.confirmed,
        allConfirmed: all.confirmed,
      });

      if (verdict === 'all booked') {
        setStatus('warn',
          `All ${form.roomType} rooms are booked for ${windowLabel} on ${form.date}.`);
      } else if (verdict === 'no such rooms') {
        setStatus('warn',
          `No such rooms: there are no ${form.roomType} rooms for ${form.date}.`);
      } else {
        // 'unconfirmed' (or 'has availability' edge): do not assert a verdict.
        setStatus('warn',
          'Could not confirm whether these rooms are booked or absent. Try Search again.');
        return;
      }
      saveLastSearch(form);
      showReuseChip(form);
    } catch (e) {
      setStatus('error', 'Search failed: ' + (e && e.message ? e.message : String(e)));
    } finally {
      ui.searchBtn.disabled = false;
    }
  }

  async function initSearchPanel() {
    // If required ids are missing, render the "RBS page changed" state.
    const missing = missingControlIds();
    const host = el('div', { id: 'rbs-room-finder-host' });
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    if (missing.length) {
      const style = el('style', { text: PANEL_CSS });
      const panel = el('div', { class: 'rbs-panel' }, [
        el('div', { class: 'rbs-header' }, [el('span', { class: 'rbs-title', text: 'RBS Room Finder' })]),
        el('div', { class: 'rbs-body' }, [
          el('div', { class: 'rbs-status rbs-visible rbs-error' },
            'RBS page changed \u2014 controls not found: ' + missing.map((id) => '#' + id).join(', ')),
        ]),
      ]);
      shadow.appendChild(style);
      shadow.appendChild(panel);
      return;
    }

    const roomTypes = readRoomTypes();
    buildPanel(shadow, roomTypes);

    ui.searchBtn.addEventListener('click', onSearch);
    ui.reuseChip.addEventListener('click', () => {
      loadLastSearch().then((last) => {
        applyForm(last, roomTypes);
        onSearch();
      });
    });

    const last = await loadLastSearch();
    if (last) {
      applyForm(last, roomTypes);
      showReuseChip(last);
    } else {
      // No last search: honor the popup's "default room type" preference.
      const def = await loadDefaultType();
      if (def && roomTypes.includes(def)) ui.typeSelect.value = def;
    }
  }

  function initLauncher() {
    const host = el('div', { id: 'rbs-room-finder-launcher-host' });
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const style = el('style', { text: PANEL_CSS });
    const link = el('a', { href: SEARCH_PATH, text: '\uD83D\uDD0D Open RBS Room Finder' });
    const launcher = el('div', { class: 'rbs-launcher' }, [link]);
    shadow.appendChild(style);
    shadow.appendChild(launcher);
  }

  // Publish a snapshot of what we see on this page to chrome.storage.local so
  // the popup can show a status line WITHOUT any extra permissions (storage
  // only). The popup never injects scripts.
  function publishProbe() {
    try {
      const snapshot = {
        url: location.href,
        path: location.pathname,
        isSearchPage: isSearchPage(),
        missing: missingControlIds(),
        roomTypes: isSearchPage() ? readRoomTypes() : [],
        at: Date.now(),
      };
      chrome.storage.local.set({ rbsProbe: snapshot });
    } catch (e) {
      /* non-fatal */
    }
  }

  function init() {
    if (!document.body) {
      window.addEventListener('DOMContentLoaded', init, { once: true });
      return;
    }
    publishProbe();
    if (document.getElementById('rbs-room-finder-host') ||
        document.getElementById('rbs-room-finder-launcher-host')) {
      return;
    }
    if (isSearchPage()) initSearchPanel();
    else initLauncher();
  }

  init();
})();
