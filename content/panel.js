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
    formatDate,
    formatWindow,
    buildSearchPlan,
    parseResults,
    filterAndSortRooms,
    classifyEmpty,
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
  function missingControlIds() {
    const required = [
      RBS_CONTROL_IDS.resourceType,
      RBS_CONTROL_IDS.date,
      RBS_CONTROL_IDS.start,
      RBS_CONTROL_IDS.end,
      RBS_CONTROL_IDS.status,
      RBS_CONTROL_IDS.searchButton,
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

  // Drive all controls with the settle + re-read-before-click rules, then click
  // Search and wait for the re-render. After clicking, re-read once more.
  //
  // @returns {Promise<{trusted: boolean, mismatched: Array}>}
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
        return { trusted: false, mismatched, html: null };
      }
    }

    // 3. Click Search and wait for the re-render.
    const btn = document.getElementById(RBS_CONTROL_IDS.searchButton);
    if (!btn) return { trusted: false, mismatched: [{ id: RBS_CONTROL_IDS.searchButton }], html: null };
    if (onProgress) onProgress('Searching\u2026');
    btn.click();
    await sleep(plan.settleMs);

    // 4. After results render, re-read the selectors. They must still show the
    //    requested window; otherwise mark the result untrusted (rule 3).
    const afterMismatch = verifyMutations(plan.mutations);
    const html = document.body ? document.body.innerHTML : '';
    return { trusted: afterMismatch.length === 0, mismatched: afterMismatch, html };
  }

  // Select a room's native checkbox and scroll the booking form into view.
  // Never auto-submits (rule from spec). Returns true if a checkbox was found.
  function selectNativeRoom(roomName) {
    // Find a table row whose text includes "<roomName>/" then its checkbox.
    const rows = Array.from(document.querySelectorAll('tr'));
    for (const row of rows) {
      const txt = (row.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt.indexOf(roomName + '/') !== -1 || txt.indexOf(roomName + ' ') === 0) {
        const cb = row.querySelector('input[type="checkbox"]');
        if (cb) {
          if (!cb.checked) {
            cb.checked = true;
            fireChange(cb);
          }
          cb.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return true;
        }
      }
    }
    // Fallback: scroll the search button / form region into view.
    const btn = document.getElementById(RBS_CONTROL_IDS.searchButton);
    if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
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

  function showBookNote() {
    ui.bookNote.className = 'rbs-book-note rbs-visible';
    ui.bookNote.textContent = 'Confirm on the form below \u2014 nothing is booked until you submit.';
  }

  function renderResults(rooms, windowLabel) {
    ui.resultsBox.textContent = '';
    for (const room of rooms) {
      const card = el('div', { class: 'rbs-card' }, [
        el('div', { class: 'rbs-card-main' }, [
          el('div', { class: 'rbs-card-name', text: room.name }),
          el('div', { class: 'rbs-card-meta' }, [
            el('span', { class: 'rbs-cap-pill', text: 'cap ' + room.capacity }),
            document.createTextNode('free ' + windowLabel),
          ]),
        ]),
        el('button', {
          class: 'rbs-book-btn',
          text: 'Book',
          onclick: () => {
            selectNativeRoom(room.name);
            showBookNote();
          },
        }),
      ]);
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

  // Run a search for a given status and return parsed rooms + trust + rowCount.
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
    if (!res.trusted) {
      return { trusted: false, mismatched: res.mismatched, rooms: [], rowCount: 0 };
    }
    const rooms = parseResults(res.html || '');
    return { trusted: true, rooms, rowCount: rooms.length, minCapacity: plan.minCapacity };
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

    try {
      setStatus('info', 'Searching \u2014 driving the native controls\u2026');
      const avail = await searchOnce(form, 'Available', (p) => setStatus('info', p));

      if (!avail.trusted) {
        const ids = avail.mismatched.map((m) => '#' + m.id).join(', ');
        setStatus('warn',
          'Result not trusted: the native controls reset mid-search (' + ids +
          '). Try Search again.');
        return;
      }

      const filtered = filterAndSortRooms(avail.rooms, form.minCapacity);

      if (filtered.length > 0) {
        setStatus('info',
          `${filtered.length} room(s) free for the entire window ${windowLabel}.`);
        renderResults(filtered, windowLabel);
        saveLastSearch(form);
        showReuseChip(form);
        return;
      }

      // Zero available rows. Distinguish "all booked" vs "no such rooms" by
      // re-running the SAME window with bookingstatus=All exactly once (rule).
      setStatus('info', 'None free \u2014 checking whether they are booked or absent\u2026');
      const all = await searchOnce(form, 'All', (p) => setStatus('info', p));

      if (!all.trusted) {
        setStatus('warn', 'Could not confirm (controls reset during the All check). Try again.');
        return;
      }

      const verdict = classifyEmpty({ rowsWithAll: all.rowCount, rowsAvailable: avail.rowCount });
      if (verdict === 'all booked') {
        setStatus('warn',
          `All ${form.roomType} rooms are booked for ${windowLabel} on ${form.date}.`);
      } else {
        setStatus('warn',
          `No such rooms: there are no ${form.roomType} rooms for ${form.date}.`);
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
