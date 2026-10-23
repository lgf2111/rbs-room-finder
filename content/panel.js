/*
 * content/panel.js
 *
 * The RBS Room Finder content script UI — an AVAILABILITY BOARD.
 *
 * Responsibilities:
 *   - On /SRB001/SRB001Page: inject a floating panel inside a SHADOW ROOT so
 *     WebForms CSS can't leak in and ours can't leak out.
 *   - On other rbs.singaporetech.edu.sg pages: inject only a launcher button.
 *   - Fetch the room list once (POST /SRB001/SearchSRB001List), render every
 *     room as a block of skeleton slot cells immediately, then lazily fill each
 *     room's slots one request at a time (POST
 *     /SRB001/GetTimeSlotListByresidNdatetime).
 *   - Single-flight: exactly ONE slot request in flight at any moment (the
 *     server serialises per session; parallelism only hurts). Blocks in the
 *     viewport jump the queue via IntersectionObserver.
 *   - Cache every slot response in memory keyed rsrcId|date|window|status;
 *     a re-render never refetches a cached room.
 *   - Changing type/date/window/capacity bumps a generation counter and
 *     abandons the in-flight queue's results so stale responses never paint.
 *   - Book: dispatch a real click on the native room card, verify selection,
 *     scroll the native action bar into view. NEVER submit anything.
 *
 * Pure helpers (parseRooms, parseSlots, buildSlotAxis, ...) come from
 * content/native.js, which is loaded first and exposes them on globalThis.
 */

(function () {
  'use strict';

  const SEARCH_PATH = '/SRB001/SRB001Page';
  const STORAGE_KEY = 'rbsLastBoard';

  const N = globalThis.RBS_NATIVE || globalThis;
  const {
    RBS_CONTROL_IDS,
    RBS_ENDPOINTS,
    DEFAULT_WINDOW,
    formatDate,
    formatWindow,
    buildSearchPayload,
    buildSlotPayload,
    encodeForm,
    parseRooms,
    parseSlots,
    buildSlotAxis,
    alignSlots,
    classifyEmpty,
    createSlotQueue,
  } = N;

  // Guard: if native.js failed to load, do nothing rather than throw on page.
  if (typeof buildSearchPayload !== 'function' || typeof createSlotQueue !== 'function') {
    return;
  }

  // ---- utilities ------------------------------------------------------------

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

  // Read the FRESH anti-forgery token before each request.
  function readToken() {
    const input = document.querySelector('input[name=__RequestVerificationToken]');
    return input ? input.value || '' : '';
  }

  // Read option TEXTs from a native <select>, skipping placeholders.
  function readOptionTexts(id) {
    const sel = document.getElementById(id);
    if (!sel) return [];
    return Array.from(sel.options)
      .map((o) => (o.textContent || '').trim())
      .filter((t) => t && !/^-+$/.test(t) && !/please select/i.test(t));
  }

  // Room types: the option texts of #resourceType. '' = "All rooms".
  function readRoomTypes() {
    return readOptionTexts(RBS_CONTROL_IDS.resourceType);
  }

  // The day-window option texts ("07:00" ... "22:30") from the native selects.
  function readWindowOptions() {
    const from = readOptionTexts(RBS_CONTROL_IDS.start).filter((t) => /^\d{2}:\d{2}$/.test(t));
    const to = readOptionTexts(RBS_CONTROL_IDS.end).filter((t) => /^\d{2}:\d{2}$/.test(t));
    return { from, to };
  }

  // The current campus/building values from the native hidden selects.
  function readIdValue(id) {
    const node = document.getElementById(id);
    return node ? node.value || '' : '';
  }

  // Today + next 7 days as { value, label }.
  function buildDateOptions() {
    const out = [];
    const now = new Date();
    for (let i = 0; i <= 7; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      out.push({ value: formatDate(d), label: i === 0 ? `${formatDate(d)} (today)` : formatDate(d) });
    }
    return out;
  }

  // Which required native ids are missing? Gate the board on ALL of these.
  function missingControlIds() {
    const required = [
      RBS_CONTROL_IDS.resourceType,
      RBS_CONTROL_IDS.date,
      RBS_CONTROL_IDS.start,
      RBS_CONTROL_IDS.end,
      RBS_CONTROL_IDS.searchButton,
      RBS_CONTROL_IDS.building,
      RBS_CONTROL_IDS.campus,
    ];
    return required.filter((id) => !document.getElementById(id));
  }

  // ---- live API layer (same-origin POSTs) -----------------------------------

  // Thrown for a non-OK HTTP status or unparseable JSON so the caller can show
  // "the RBS API returned an error (HTTP n)" and keep the previous board.
  function ApiError(message, httpStatus) {
    const e = new Error(message);
    e.httpStatus = httpStatus;
    return e;
  }

  async function postForm(endpoint, fields) {
    let resp;
    try {
      resp = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: encodeForm(fields),
      });
    } catch (e) {
      throw ApiError('network error contacting RBS', 0);
    }
    if (!resp.ok) {
      throw ApiError(`the RBS API returned an error (HTTP ${resp.status})`, resp.status);
    }
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      throw ApiError('the RBS API returned an error (unparseable JSON)', resp.status);
    }
  }

  // Fetch the room list for the chosen filters. Returns parseRooms() output.
  async function fetchRooms(form) {
    const fields = buildSearchPayload({
      token: readToken(),
      capacityOperator: readIdValue(RBS_CONTROL_IDS.capacityOperator) || '',
      campusID: readIdValue(RBS_CONTROL_IDS.campus),
      buildingID: readIdValue(RBS_CONTROL_IDS.building),
      status: 'All',
      resourceType: form.roomType, // option TEXT; '' = all types
      date: form.date,
      start: form.window.start,
      end: form.window.end,
    });
    const json = await postForm(RBS_ENDPOINTS.searchList, fields);
    return parseRooms(json);
  }

  // Fetch one room's slots. Returns parseSlots() output.
  async function fetchSlots(room, form) {
    const fields = buildSlotPayload(room, form.date, form.window, 'All', readToken());
    const json = await postForm(RBS_ENDPOINTS.slotList, fields);
    return parseSlots(json);
  }

  // ---- board state ----------------------------------------------------------

  const board = {
    form: null, // { roomType, date, window:{start,end}, minCapacity, sort }
    axis: [], // shared time labels
    rooms: [], // parseRooms output (filtered + sorted), current render order
    queue: null, // createSlotQueue instance
    cache: new Map(), // persists across renders; keyed rsrcId|date|window|status
    blocks: new Map(), // roomId -> { rowEl, cellsEl, cells, loaded }
    observer: null, // IntersectionObserver for viewport prioritisation
    generation: 0,
    loadedCount: 0,
    totalCount: 0,
  };

  // ---- native Book action (never submits) -----------------------------------

  // Ids / text that must NEVER be clicked by us (they commit a booking).
  const FORBIDDEN_CLICK_IDS = [
    'btnBookingSave', 'btnConfirmBookingSave', 'btnBookingNext', 'btnBooking',
    'btnBookingMainClear', 'btnMultipleBookingConfirm', 'btnMultipleBookingConfirmSave',
  ];

  const SELECT_CONFIRM_MS = 2500;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // The native card for a room id: .cardinfoSingle[data-rsrcid="<RSRC_ID>"].
  function findNativeCard(rsrcId) {
    const sel = `.cardinfoSingle[data-rsrcid="${cssEscape(rsrcId)}"]`;
    return document.querySelector(sel);
  }

  function cssEscape(s) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
    return String(s).replace(/["\\]/g, '\\$&');
  }

  function detailPopupVisible() {
    const modal = document.getElementById('Modal-detailPopup');
    if (!modal) return false;
    // Visible if displayed and has a box.
    const style = window.getComputedStyle ? window.getComputedStyle(modal) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    return modal.offsetWidth > 0 || modal.offsetHeight > 0 || modal.classList.contains('show');
  }

  function selectionBadgeText() {
    const all = document.body ? document.body.textContent || '' : '';
    const m = /(\d+)\s+Facilit(?:y|ies)\s+Selected/i.exec(all);
    return m ? m[0] : null;
  }

  function scrollActionBarIntoView() {
    const anchor =
      document.getElementById('btnBooking') ||
      (() => {
        const candidates = Array.from(
          document.querySelectorAll('span, div, button, a, label')
        );
        return candidates.find((n) =>
          /\d+\s+Facilit(?:y|ies)\s+Selected/i.test((n.textContent || '').trim())
        );
      })();
    if (anchor && typeof anchor.scrollIntoView === 'function') {
      anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // Click the native card to select/open, then verify. Never clicks a submit.
  async function bookRoom(room) {
    const card = findNativeCard(room.id);
    if (!card) return { ok: false, reason: 'card-not-found' };

    // Never dispatch a click onto a forbidden submit control.
    const forbidden = FORBIDDEN_CLICK_IDS.some((id) => card.id === id || card.closest('#' + id));
    if (forbidden) return { ok: false, reason: 'refused-forbidden-target' };

    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.click();

    const deadline = Date.now() + SELECT_CONFIRM_MS;
    while (Date.now() < deadline) {
      await sleep(150);
      if (detailPopupVisible()) return { ok: true, signal: 'detail-popup' };
      const badge = selectionBadgeText();
      if (badge) {
        scrollActionBarIntoView();
        return { ok: true, signal: 'badge', badge };
      }
    }
    return { ok: false, reason: 'no-signal' };
  }

  // ---- panel CSS (embedded so it lives inside the shadow root) --------------
  // Kept in sync with content/panel.css.
  const PANEL_CSS = `
:host{all:initial}
*,*::before,*::after{box-sizing:border-box}
.rbs-panel{position:fixed;top:72px;right:20px;width:560px;max-width:calc(100vw - 40px);max-height:calc(100vh - 96px);display:flex;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.4;color:#1f2933;background:#fff;border:1px solid #d6dde5;border-radius:12px;box-shadow:0 10px 30px rgba(16,24,40,.18);z-index:2147483000;overflow:hidden}
.rbs-panel.rbs-collapsed .rbs-body{display:none}
.rbs-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;background:linear-gradient(135deg,#1b4965,#2a6f97);color:#fff;cursor:move}
.rbs-title{font-weight:600;font-size:14px;letter-spacing:.2px}
.rbs-header-actions{display:flex;gap:6px}
.rbs-icon-btn{appearance:none;border:none;background:rgba(255,255,255,.16);color:#fff;width:24px;height:24px;border-radius:6px;cursor:pointer;font-size:14px;line-height:1;display:inline-flex;align-items:center;justify-content:center}
.rbs-icon-btn:hover{background:rgba(255,255,255,.3)}
.rbs-body{padding:12px 14px;overflow-y:auto;display:flex;flex-direction:column;min-height:0}
.rbs-controls{display:grid;grid-template-columns:1fr 1fr;gap:8px 10px}
.rbs-field{margin:0}
.rbs-field.rbs-span2{grid-column:1 / -1}
.rbs-field label{display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:#52606d;margin-bottom:4px}
.rbs-field select,.rbs-field input{width:100%;padding:7px 9px;border:1px solid #cbd2d9;border-radius:8px;background:#fff;color:#1f2933;font-size:13px}
.rbs-field select:focus,.rbs-field input:focus{outline:2px solid #2a6f97;outline-offset:0;border-color:#2a6f97}
.rbs-row{display:flex;gap:8px}
.rbs-row .rbs-field{flex:1}
.rbs-load-btn{appearance:none;width:100%;border:none;background:#2a6f97;color:#fff;font-weight:600;font-size:14px;padding:10px;border-radius:9px;cursor:pointer;margin-top:10px}
.rbs-load-btn:hover{background:#1b4965}
.rbs-load-btn:disabled{background:#9fb3c0;cursor:progress}
.rbs-status{margin-top:10px;padding:9px 10px;border-radius:8px;font-size:12px;background:#f1f5f8;color:#3e4c59;display:none}
.rbs-status.rbs-visible{display:block}
.rbs-status.rbs-error{background:#fdecea;color:#8a1c13}
.rbs-status.rbs-warn{background:#fff6e5;color:#8a5a00}
.rbs-status.rbs-info{background:#eaf3f9;color:#1b4965}
.rbs-progress{margin-top:8px;font-size:11px;color:#52606d;display:none}
.rbs-progress.rbs-visible{display:block}
.rbs-boardwrap{margin-top:10px;overflow:auto;flex:1;min-height:0;border:1px solid #e4e9ef;border-radius:10px}
.rbs-axis{position:sticky;top:0;z-index:2;display:grid;background:#f7f9fb;border-bottom:1px solid #e4e9ef}
.rbs-axis-label{font-size:10px;color:#52606d;padding:3px 0;text-align:center;border-left:1px solid #eef2f6;white-space:nowrap}
.rbs-axis-label.rbs-hour{font-weight:600;color:#1b4965}
.rbs-block{border-bottom:1px solid #eef2f6;padding:6px 8px}
.rbs-block:last-child{border-bottom:none}
.rbs-block-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px}
.rbs-block-name{font-weight:600;font-size:12px;color:#1f2933;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rbs-block-meta{font-size:11px;color:#6b7785}
.rbs-cap-pill{display:inline-block;background:#eaf3f9;color:#1b4965;border-radius:999px;padding:0 7px;font-weight:600;margin-right:6px}
.rbs-slotrow{display:grid;gap:1px}
.rbs-cell{height:18px;border-radius:2px;background:#e4e9ef}
.rbs-cell.rbs-free{background:#37a86b}
.rbs-cell.rbs-taken{background:#d1515a}
.rbs-cell.rbs-unknown{background:#cfd6de}
.rbs-cell.rbs-dim{opacity:.32}
.rbs-cell.rbs-skel{background:linear-gradient(90deg,#e4e9ef 25%,#eef2f6 37%,#e4e9ef 63%);background-size:400% 100%;animation:rbs-shimmer 1.2s ease-in-out infinite}
@keyframes rbs-shimmer{0%{background-position:100% 0}100%{background-position:0 0}}
.rbs-block-actions{display:flex;align-items:center;gap:8px}
.rbs-book-btn{appearance:none;border:1px solid #2a6f97;background:#fff;color:#2a6f97;font-weight:600;font-size:11px;padding:4px 10px;border-radius:7px;cursor:pointer;flex:none}
.rbs-book-btn:hover{background:#2a6f97;color:#fff}
.rbs-retry-btn{appearance:none;border:1px solid #d1515a;background:#fff;color:#b23640;font-weight:600;font-size:11px;padding:4px 10px;border-radius:7px;cursor:pointer}
.rbs-retry-btn:hover{background:#d1515a;color:#fff}
.rbs-block-note{font-size:11px;margin-top:4px;color:#8a5a00}
.rbs-block-note.rbs-error{color:#8a1c13}
.rbs-book-note{margin-top:8px;padding:9px 10px;border-radius:8px;background:#fff6e5;color:#8a5a00;font-size:12px;display:none}
.rbs-book-note.rbs-visible{display:block}
.rbs-book-note.rbs-error{background:#fdecea;color:#8a1c13}
.rbs-launcher{position:fixed;bottom:22px;right:22px;z-index:2147483000;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.rbs-launcher a{display:inline-flex;align-items:center;gap:8px;background:#2a6f97;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 16px;border-radius:999px;box-shadow:0 8px 22px rgba(16,24,40,.22)}
.rbs-launcher a:hover{background:#1b4965}
`;

  let ui = null;

  // ---- panel construction ---------------------------------------------------

  function buildPanel(shadow, roomTypes, windowOpts) {
    const dateOptions = buildDateOptions();

    const typeSelect = el('select', { id: 'rbs-type' });
    typeSelect.appendChild(el('option', { value: '', text: 'All rooms' }));
    for (const t of roomTypes) typeSelect.appendChild(el('option', { value: t, text: t }));

    const dateSelect = el('select', { id: 'rbs-date' });
    for (const d of dateOptions) dateSelect.appendChild(el('option', { value: d.value, text: d.label }));

    const startSelect = el('select', { id: 'rbs-start' });
    for (const t of windowOpts.from) startSelect.appendChild(el('option', { value: t, text: t }));
    const endSelect = el('select', { id: 'rbs-end' });
    for (const t of windowOpts.to) endSelect.appendChild(el('option', { value: t, text: t }));
    if (windowOpts.from.includes(DEFAULT_WINDOW.start)) startSelect.value = DEFAULT_WINDOW.start;
    if (windowOpts.to.includes(DEFAULT_WINDOW.end)) endSelect.value = DEFAULT_WINDOW.end;

    const capInput = el('input', { id: 'rbs-cap', type: 'number', min: '0', step: '1', value: '0' });

    const sortSelect = el('select', { id: 'rbs-sort' }, [
      el('option', { value: 'name', text: 'Room name' }),
      el('option', { value: 'capacity', text: 'Capacity (desc)' }),
    ]);

    const loadBtn = el('button', { class: 'rbs-load-btn', text: 'Load board' });

    const statusBox = el('div', { class: 'rbs-status' });
    const progressBox = el('div', { class: 'rbs-progress' });
    const bookNote = el('div', { class: 'rbs-book-note' });
    const boardWrap = el('div', { class: 'rbs-boardwrap' });

    const controls = el('div', { class: 'rbs-controls' }, [
      el('div', { class: 'rbs-field rbs-span2' }, [el('label', { text: 'Room type' }), typeSelect]),
      el('div', { class: 'rbs-field rbs-span2' }, [el('label', { text: 'Date' }), dateSelect]),
      el('div', { class: 'rbs-field' }, [el('label', { text: 'Start' }), startSelect]),
      el('div', { class: 'rbs-field' }, [el('label', { text: 'End' }), endSelect]),
      el('div', { class: 'rbs-field' }, [el('label', { text: 'Min capacity' }), capInput]),
      el('div', { class: 'rbs-field' }, [el('label', { text: 'Sort' }), sortSelect]),
    ]);

    const body = el('div', { class: 'rbs-body' }, [
      controls,
      loadBtn,
      statusBox,
      progressBox,
      bookNote,
      boardWrap,
    ]);

    const collapseBtn = el('button', { class: 'rbs-icon-btn', title: 'Collapse', text: '\u2013' });
    const header = el('div', { class: 'rbs-header' }, [
      el('span', { class: 'rbs-title', text: 'RBS Availability Board' }),
      el('div', { class: 'rbs-header-actions' }, [collapseBtn]),
    ]);

    const panel = el('div', { class: 'rbs-panel' }, [header, body]);

    collapseBtn.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('rbs-collapsed');
      collapseBtn.textContent = collapsed ? '+' : '\u2013';
      collapseBtn.title = collapsed ? 'Expand' : 'Collapse';
    });

    makeDraggable(panel, header);

    shadow.appendChild(el('style', { text: PANEL_CSS }));
    shadow.appendChild(panel);

    ui = {
      panel, typeSelect, dateSelect, startSelect, endSelect, capInput, sortSelect,
      loadBtn, statusBox, progressBox, bookNote, boardWrap,
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
    ui.statusBox.className = 'rbs-status rbs-visible' + (kind ? ' rbs-' + kind : '');
    ui.statusBox.textContent = text;
  }

  function setProgress(text) {
    if (!text) {
      ui.progressBox.className = 'rbs-progress';
      ui.progressBox.textContent = '';
      return;
    }
    ui.progressBox.className = 'rbs-progress rbs-visible';
    ui.progressBox.textContent = text;
  }

  function showBookNote(kind, text) {
    ui.bookNote.className = 'rbs-book-note rbs-visible' + (kind ? ' rbs-' + kind : '');
    ui.bookNote.textContent = text;
  }

  // ---- rendering ------------------------------------------------------------

  // Measured per-room latency used only to hint remaining time to the user.
  const SLOT_SECS_PER_ROOM = 2.2;

  // Build the sticky axis header: a label per cell, hour labels emphasised.
  function renderAxis() {
    const axis = board.axis;
    const header = el('div', { class: 'rbs-axis' });
    header.style.gridTemplateColumns = `180px repeat(${axis.length}, 1fr)`;
    header.appendChild(el('div', { class: 'rbs-axis-label', text: '' }));
    for (const label of axis) {
      const onHour = /:00$/.test(label);
      header.appendChild(
        el('div', { class: 'rbs-axis-label' + (onHour ? ' rbs-hour' : ''), title: label },
          onHour ? label : '\u00b7')
      );
    }
    return header;
  }

  // One block per room: header line + a row of slot cells.
  function renderBlock(room) {
    const cells = [];
    const slotRow = el('div', { class: 'rbs-slotrow' });
    slotRow.style.gridTemplateColumns = `repeat(${board.axis.length}, 1fr)`;
    for (let i = 0; i < board.axis.length; i++) {
      const c = el('div', { class: 'rbs-cell rbs-skel' });
      cells.push(c);
      slotRow.appendChild(c);
    }

    const bookBtn = el('button', { class: 'rbs-book-btn', text: 'Book' });
    bookBtn.addEventListener('click', () => onBook(room, bookBtn));

    const actions = el('div', { class: 'rbs-block-actions' }, [bookBtn]);
    const note = el('div', { class: 'rbs-block-note' });
    note.style.display = 'none';

    const head = el('div', { class: 'rbs-block-head' }, [
      el('div', { class: 'rbs-block-name', text: room.name, title: room.name }),
      el('div', { class: 'rbs-block-meta' }, [
        el('span', { class: 'rbs-cap-pill', text: 'cap ' + room.capacity }),
        document.createTextNode(room.type || ''),
      ]),
      actions,
    ]);

    // The row grid aligns with the axis: a 180px name gutter + N cells. We wrap
    // head + cells so each block shares the same axis columns.
    const gutter = el('div', {});
    gutter.style.display = 'grid';
    gutter.style.gridTemplateColumns = `180px 1fr`;
    gutter.style.alignItems = 'center';
    gutter.style.gap = '8px';
    gutter.appendChild(head);
    gutter.appendChild(slotRow);

    const block = el('div', { class: 'rbs-block', 'data-rsrcid': room.id }, [gutter]);
    // Keep head full-width above the row on narrow widths by letting it span.
    head.style.gridColumn = '1 / -1';
    head.style.width = '100%';

    board.blocks.set(room.id, { block, cells, note, bookBtn, loaded: false, room });
    return block;
  }

  // Paint one room's cells from slot data (fresh generation only).
  function paintBlock(roomId, slots) {
    const entry = board.blocks.get(roomId);
    if (!entry) return;
    entry.loaded = true;
    const aligned = alignSlots(board.axis, slots);
    const startMin = N.timeToMinutes(board.form.window.start);
    const endMin = N.timeToMinutes(board.form.window.end);
    for (let i = 0; i < entry.cells.length; i++) {
      const cell = entry.cells[i];
      const slot = aligned[i];
      const label = board.axis[i];
      cell.className = 'rbs-cell';
      // Dim cells whose START falls outside the chosen window (axis is stable).
      const mins = N.timeToMinutes(label);
      const outside = mins < startMin || mins >= endMin;
      if (!slot) {
        cell.classList.add('rbs-unknown');
        cell.title = `${label} — no data`;
      } else if (slot.state === 'free') {
        cell.classList.add('rbs-free');
        cell.title = `${label} — free`;
      } else if (slot.state === 'taken') {
        cell.classList.add('rbs-taken');
        cell.title = `${label} — taken (status ${slot.status})`;
      } else {
        cell.classList.add('rbs-unknown');
        cell.title = `${label} — unknown (status ${slot.status})`;
      }
      if (outside) cell.classList.add('rbs-dim');
    }
    hideBlockNote(entry);
    if (entry.retryBtn && entry.retryBtn.isConnected) {
      entry.retryBtn.remove();
      entry.retryBtn = null;
    }
  }

  // Count a room as reaching a terminal state (loaded or failed) exactly once.
  function accountRoom(roomId) {
    const entry = board.blocks.get(roomId);
    if (!entry || entry.accounted) return;
    entry.accounted = true;
    board.loadedCount += 1;
  }

  function markBlockFailed(roomId) {
    const entry = board.blocks.get(roomId);
    if (!entry) return;
    showBlockNote(entry, 'error', 'failed');
    // Offer a retry button (added once; reused on repeated failures).
    if (!entry.retryBtn) {
      const retry = el('button', { class: 'rbs-retry-btn', text: 'retry' });
      retry.addEventListener('click', () => {
        if (entry.loaded) return;
        hideBlockNote(entry);
        for (const c of entry.cells) c.className = 'rbs-cell rbs-skel';
        // Re-enqueue just this room at the front of the queue and drain. It was
        // already accounted as terminal, so undo that before it runs again.
        if (entry.accounted) {
          entry.accounted = false;
          board.loadedCount = Math.max(0, board.loadedCount - 1);
          updateProgress();
        }
        board.queue.enqueue(entry.room);
        board.queue.prioritize(entry.room.id);
        board.queue.run();
      });
      entry.retryBtn = retry;
      entry.bookBtn.parentElement.appendChild(retry);
    }
  }

  function showBlockNote(entry, kind, text) {
    entry.note.style.display = 'block';
    entry.note.className = 'rbs-block-note' + (kind ? ' rbs-' + kind : '');
    entry.note.textContent = text === 'failed' ? 'failed \u2014 retry' : text;
    if (!entry.note.isConnected) entry.block.appendChild(entry.note);
  }

  function hideBlockNote(entry) {
    entry.note.style.display = 'none';
    entry.note.textContent = '';
  }

  // ---- Book handler ---------------------------------------------------------

  async function onBook(room, btn) {
    btn.disabled = true;
    showBookNote('', 'Selecting ' + room.name + ' on the native page\u2026');
    try {
      const res = await bookRoom(room);
      if (res.ok) {
        if (res.signal === 'detail-popup') {
          showBookNote('',
            room.name + ': booking-rule popup opened. Confirm below \u2014 nothing is ' +
            'booked until you click Book.');
        } else {
          showBookNote('',
            (res.badge || '1 Facility Selected') + ' \u2014 confirm below; nothing is ' +
            'booked until you click Book.');
          scrollActionBarIntoView();
        }
      } else if (res.reason === 'card-not-found') {
        showBookNote('error',
          'Could not find ' + room.name + ' on the native page. Scroll the native ' +
          'results and click the room card yourself.');
      } else {
        showBookNote('error',
          'Selection did not take \u2014 click the ' + room.name + ' room card yourself.');
      }
    } catch (e) {
      showBookNote('error', 'Selection failed: ' + (e && e.message ? e.message : String(e)));
    } finally {
      btn.disabled = false;
    }
  }

  // ---- form + sorting -------------------------------------------------------

  function readForm() {
    return {
      roomType: ui.typeSelect.value, // '' = all rooms
      date: ui.dateSelect.value,
      window: { start: ui.startSelect.value, end: ui.endSelect.value },
      minCapacity: Number(ui.capInput.value) || 0,
      sort: ui.sortSelect.value,
    };
  }

  function sortRooms(rooms, sort) {
    const list = rooms.slice();
    if (sort === 'capacity') {
      list.sort((a, b) => b.capacity - a.capacity || a.name.localeCompare(b.name));
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }

  function updateProgress() {
    const total = board.totalCount;
    const done = board.loadedCount;
    if (done >= total) {
      setProgress(`${done}/${total} rooms loaded`);
      return;
    }
    const remainingSecs = Math.max(0, (total - done) * SLOT_SECS_PER_ROOM);
    setProgress(`${done}/${total} rooms loaded \u2014 ~${remainingSecs.toFixed(0)}s remaining`);
  }

  // ---- the main Load board flow ---------------------------------------------

  async function onLoadBoard() {
    const form = readForm();

    // Validate the window.
    const sMin = N.timeToMinutes(form.window.start);
    const eMin = N.timeToMinutes(form.window.end);
    if (isNaN(sMin) || isNaN(eMin) || eMin <= sMin) {
      setStatus('error', `End time (${form.window.end}) must be after start time (${form.window.start}).`);
      return;
    }

    // A new load bumps the generation: any in-flight queue is abandoned.
    board.generation += 1;
    if (board.queue) board.queue.bumpGeneration();

    board.form = form;
    board.axis = buildSlotAxis(form.window.start, form.window.end);
    board.blocks = new Map();
    board.loadedCount = 0;
    if (board.observer) { board.observer.disconnect(); board.observer = null; }

    ui.loadBtn.disabled = true;
    setProgress('');
    ui.bookNote.className = 'rbs-book-note';
    setStatus('info', 'Loading the room list\u2026');

    let rooms;
    try {
      rooms = await fetchRooms(form);
    } catch (e) {
      // Leave the previous board intact on an API error.
      setStatus('error', apiMessage(e));
      ui.loadBtn.disabled = false;
      return;
    }

    const roomsFromSearch = rooms.length;
    const filtered = rooms.filter((r) => r.capacity >= form.minCapacity);
    const ordered = sortRooms(filtered, form.sort);
    board.rooms = ordered;
    board.totalCount = ordered.length;

    // Zero rooms: say WHICH case using the counts.
    if (ordered.length === 0) {
      // roomsFromSearch 0 -> "no rooms match"; else capacity filter removed all.
      ui.boardWrap.textContent = '';
      if (roomsFromSearch === 0) {
        setStatus('warn', 'No rooms match these filters.');
      } else {
        setStatus('warn',
          `No rooms at or above capacity ${form.minCapacity} (the search returned ` +
          `${roomsFromSearch} room(s)).`);
      }
      setProgress('');
      ui.loadBtn.disabled = false;
      saveLast(form);
      return;
    }

    // Render axis + all skeleton blocks immediately.
    renderBoardSkeleton(ordered);
    setStatus('info', `Found ${ordered.length} room(s). Loading slots one at a time\u2026`);
    updateProgress();

    // Build the single-flight queue. The queue is the ONLY place slot fetches
    // happen, and it guarantees one request in flight at a time.
    const myGen = board.generation;
    board.queue = createSlotQueue({
      fetcher: (room) => fetchSlots(room, form),
      date: form.date,
      window: form.window,
      status: 'All',
      cache: board.cache,
      onLoaded: (roomId, slots) => {
        if (board.generation !== myGen) return; // stale: do not paint
        paintBlock(roomId, slots);
        accountRoom(roomId);
        updateProgress();
        checkAllTaken();
      },
      onError: (roomId, err) => {
        if (board.generation !== myGen) return;
        markBlockFailed(roomId);
        accountRoom(roomId);
        updateProgress();
      },
    });

    board.queue.enqueue(ordered);

    // Viewport blocks jump the queue.
    setupObserver();

    board.queue.run().then(() => {
      if (board.generation !== myGen) return;
      ui.loadBtn.disabled = false;
      finalizeStatus();
    });

    saveLast(form);
  }

  function renderBoardSkeleton(rooms) {
    ui.boardWrap.textContent = '';
    ui.boardWrap.appendChild(renderAxis());
    for (const room of rooms) {
      ui.boardWrap.appendChild(renderBlock(room));
    }
  }

  // Prioritise blocks entering the viewport so the user sees what they look at.
  function setupObserver() {
    if (typeof IntersectionObserver === 'undefined') return;
    board.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const id = e.target.getAttribute('data-rsrcid');
          const entry = id && board.blocks.get(id);
          if (entry && !entry.loaded) {
            board.queue.prioritize(id);
          }
        }
      },
      { root: ui.boardWrap, threshold: 0.1 }
    );
    for (const entry of board.blocks.values()) {
      board.observer.observe(entry.block);
    }
  }

  // If every loaded cell is taken and all rooms are done, say so.
  function checkAllTaken() {
    if (board.loadedCount < board.totalCount) return;
    finalizeStatus();
  }

  function finalizeStatus() {
    if (board.observer) { board.observer.disconnect(); board.observer = null; }
    // Gather every painted cell state to classify the board.
    const cells = [];
    let anyFailed = false;
    for (const entry of board.blocks.values()) {
      if (!entry.loaded) { anyFailed = true; continue; }
      for (const c of entry.cells) {
        if (c.classList.contains('rbs-free')) cells.push('free');
        else if (c.classList.contains('rbs-taken')) cells.push('taken');
        else cells.push('unknown');
      }
    }
    const verdict = classifyEmpty({ rooms: board.totalCount, cells });
    if (verdict === 'all slots taken in this window') {
      setStatus('warn',
        `All ${board.totalCount} room(s) are fully taken for ` +
        `${formatWindow(board.form.window.start, board.form.window.end)} on ${board.form.date}.`);
    } else {
      setStatus('info',
        `${board.totalCount} room(s) loaded for ` +
        `${formatWindow(board.form.window.start, board.form.window.end)} on ${board.form.date}` +
        (anyFailed ? ' (some rooms failed \u2014 use retry).' : '.'));
    }
    updateProgress();
  }

  function apiMessage(e) {
    if (e && typeof e.httpStatus === 'number' && e.httpStatus > 0) {
      return `the RBS API returned an error (HTTP ${e.httpStatus}). Previous board kept.`;
    }
    return (e && e.message ? e.message : 'the RBS API returned an error') + '. Previous board kept.';
  }

  // ---- storage --------------------------------------------------------------

  function saveLast(form) {
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: form });
    } catch (e) { /* non-fatal */ }
  }

  function loadLast() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([STORAGE_KEY], (res) => resolve((res && res[STORAGE_KEY]) || null));
      } catch (e) { resolve(null); }
    });
  }

  function applyForm(form, roomTypes, windowOpts) {
    if (!form) return;
    if (form.roomType != null &&
        (form.roomType === '' || roomTypes.includes(form.roomType))) {
      ui.typeSelect.value = form.roomType;
    }
    if (form.date && Array.from(ui.dateSelect.options).some((o) => o.value === form.date)) {
      ui.dateSelect.value = form.date;
    }
    if (form.window) {
      if (form.window.start && windowOpts.from.includes(form.window.start)) ui.startSelect.value = form.window.start;
      if (form.window.end && windowOpts.to.includes(form.window.end)) ui.endSelect.value = form.window.end;
    }
    if (form.minCapacity != null) ui.capInput.value = String(form.minCapacity);
    if (form.sort) ui.sortSelect.value = form.sort;
  }

  // ---- init -----------------------------------------------------------------

  async function initSearchPanel() {
    const missing = missingControlIds();
    const host = el('div', { id: 'rbs-room-finder-host' });
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    if (missing.length) {
      shadow.appendChild(el('style', { text: PANEL_CSS }));
      shadow.appendChild(
        el('div', { class: 'rbs-panel' }, [
          el('div', { class: 'rbs-header' }, [el('span', { class: 'rbs-title', text: 'RBS Availability Board' })]),
          el('div', { class: 'rbs-body' }, [
            el('div', { class: 'rbs-status rbs-visible rbs-error' },
              'RBS page changed \u2014 controls not found: ' + missing.map((id) => '#' + id).join(', ')),
          ]),
        ])
      );
      return;
    }

    const roomTypes = readRoomTypes();
    const windowOpts = readWindowOptions();
    buildPanel(shadow, roomTypes, windowOpts);

    ui.loadBtn.addEventListener('click', onLoadBoard);

    const last = await loadLast();
    if (last) applyForm(last, roomTypes, windowOpts);
  }

  function initLauncher() {
    const host = el('div', { id: 'rbs-room-finder-launcher-host' });
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.appendChild(el('style', { text: PANEL_CSS }));
    const link = el('a', { href: SEARCH_PATH, text: '\uD83D\uDD0D Open RBS Room Finder' });
    shadow.appendChild(el('div', { class: 'rbs-launcher' }, [link]));
  }

  // Publish a snapshot for the popup (storage-only, no extra permission).
  function publishProbe() {
    try {
      chrome.storage.local.set({
        rbsProbe: {
          url: location.href,
          path: location.pathname,
          isSearchPage: isSearchPage(),
          missing: missingControlIds(),
          roomTypes: isSearchPage() ? readRoomTypes() : [],
          at: Date.now(),
        },
      });
    } catch (e) { /* non-fatal */ }
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
