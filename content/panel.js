/*
 * content/panel.js
 *
 * The RBS Room Finder full-page app.
 *
 * Replaces the floating panel with a fixed full-page overlay (inset 0).
 * Dark theme matches panel.css; loads helpers from content/native.js.
 */

(function () {
  'use strict';

  const SEARCH_PATH = '/SRB001/SRB001Page';
  const STORAGE_KEY = 'rbsLastBoard';
  const PANEL_CSS = `:host{all:initial}:root{--rbs-page:#0b0c0e;--rbs-surface:#14161a;--rbs-surface2:#1f2226;--rbs-border:#2b2f36;--rbs-primary-text:#e6e8eb;--rbs-muted:#8b9199;--rbs-accent:#c8102e;--rbs-free:#3fb950;--rbs-taken:#8b3a3a;--rbs-font:-apple-system,"Segoe UI",system-ui,sans-serif;--rbs-font-mono:ui-monospace,"SF Mono",Monaco,"Cascadia Mono",monospace;--rbs-shadow:0 4px 20px rgba(0,0,0,0.5);--rbs-gap:12px;--rbs-radius:8px;--rbs-cell-size:32px;--rbs-hour-height:40px;--rbs-row-height:32px;--rbs-topbar-height:64px;--rbs-status-height:24px}[data-theme="light"]{--rbs-page:#fff;--rbs-surface:#f8f9fa;--rbs-surface2:#e9ecef;--rbs-border:#dee2e6;--rbs-primary-text:#212529;--rbs-muted:#6c757d;--rbs-accent:#0d6efd;--rbs-free:#198754;--rbs-taken:#dc3545}*,*::before,*::after{box-sizing:border-box}.rbs-fullpage{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;background:var(--rbs-page);color:var(--rbs-primary-text);font-family:var(--rbs-font);font-size:13px;line-height:1.4;overflow:hidden}.rbs-topbar{height:var(--rbs-topbar-height);display:flex;align-items:center;padding:0 var(--rbs-gap);background:var(--rbs-surface);border-bottom:1px solid var(--rbs-border);gap:var(--rbs-gap);flex-shrink:0}.rbs-brand{display:flex;align-items:center;gap:6px;font-weight:600;color:var(--rbs-accent);margin-right:12px}.rbs-brand-text{font-size:14px}.rbs-brand-building{font-size:13px;color:var(--rbs-primary-text);margin-left:4px}.rbs-control-group{display:flex;align-items:center;gap:8px}.rbs-control-group select,.rbs-control-group input{background:var(--rbs-surface2);border:1px solid var(--rbs-border);color:var(--rbs-primary-text);border-radius:var(--rbs-radius);padding:6px 8px;font-size:12px;min-height:28px}.rbs-control-group select:focus,.rbs-control-group input:focus{outline:2px solid var(--rbs-accent);outline-offset:0}.rbs-capacity-input{width:80px}.rbs-search-input{width:120px}.rbs-date-chips{display:flex;gap:4px;overflow-x:auto;padding:2px;scrollbar-width:none}.rbs-date-chip{display:flex;flex-direction:column;align-items:center;padding:6px 8px;background:var(--rbs-surface2);border:1px solid var(--rbs-border);border-radius:var(--rbs-radius);min-width:70px;cursor:pointer;user-select:none}.rbs-date-chip:hover{background:var(--rbs-surface)}.rbs-date-chip.rbs-selected{background:var(--rbs-accent);color:white;border-color:var(--rbs-accent)}.rbs-date-weekday{font-size:10px;font-weight:600;margin-bottom:2px}.rbs-date-label{font-size:11px}.rbs-window-controls{display:flex;align-items:center;gap:4px}.rbs-window-select{width:80px}.rbs-topbar-actions{margin-left:auto;display:flex;gap:8px}.rbs-action-btn{background:var(--rbs-surface2);border:1px solid var(--rbs-border);color:var(--rbs-primary-text);border-radius:var(--rbs-radius);padding:6px 12px;font-size:12px;cursor:pointer;min-height:28px}.rbs-action-btn:hover{background:var(--rbs-surface)}.rbs-action-btn.rbs-primary{background:var(--rbs-accent);color:white;border-color:var(--rbs-accent)}.rbs-action-btn.rbs-primary:hover{background:#d93046}.rbs-main{flex:1;display:flex;overflow:hidden;position:relative}.rbs-board-area{flex:1;display:flex;flex-direction:column;overflow:hidden}.rbs-board-header{height:var(--rbs-hour-height);background:var(--rbs-surface);border-bottom:1px solid var(--rbs-border);display:grid;align-items:center;position:sticky;top:0;z-index:10}.rbs-room-label{padding:0 12px;font-family:var(--rbs-font-mono);font-size:12px;color:var(--rbs-muted);border-right:1px solid var(--rbs-border)}.rbs-board-scroll{flex:1;overflow-y:auto;overflow-x:hidden}.rbs-board-rows{display:flex;flex-direction:column}.rbs-board-row{height:var(--rbs-row-height);display:grid;align-items:center;border-bottom:1px solid var(--rbs-border)}.rbs-room-info{display:flex;align-items:center;padding:0 12px;gap:8px;font-size:12px;border-right:1px solid var(--rbs-border)}.rbs-room-code{font-family:var(--rbs-font-mono);color:var(--rbs-primary-text)}.rbs-room-type{color:var(--rbs-muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px}.rbs-room-cap{background:var(--rbs-surface2);color:var(--rbs-primary-text);border-radius:999px;padding:0 6px;font-size:10px;font-weight:600;margin-left:auto}.rbs-slot-cells{display:grid;gap:1px;height:100%;align-items:center}.rbs-slot-cell{height:100%;border-right:1px solid var(--rbs-border)}.rbs-slot-cell.rbs-free{background:var(--rbs-free)}.rbs-slot-cell.rbs-taken{background:var(--rbs-taken)}.rbs-slot-cell.rbs-unknown{background:var(--rbs-surface2)}.rbs-slot-cell.rbs-outside{opacity:0.3}.rbs-slot-cell.rbs-selected{outline:2px solid var(--rbs-accent);outline-offset:-1px;z-index:1}.rbs-slot-cell.rbs-skel{background:linear-gradient(90deg,var(--rbs-surface2) 25%,var(--rbs-surface) 37%,var(--rbs-surface2) 63%);background-size:400% 100%;animation:rbs-shimmer 1.2s ease-in-out infinite}@keyframes rbs-shimmer{0%{background-position:100% 0}100%{background-position:0 0}}@media (max-width:1100px){.rbs-topbar{flex-wrap:wrap;height:auto;padding:8px}.rbs-date-chips{order:1;width:100%;margin-top:8px}}`;

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
    timeToMinutes,
  } = N;

  // Global UI references
  let ui = null;

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

  // ---- main UI shell --------------------------------------------------------

  function buildFullPageShell(shadow, missing) {
    const host = el('div', { class: 'rbs-fullpage' });
    
    if (missing.length) {
      // Gate failed: show error panel
      shadow.appendChild(el('style', { text: PANEL_CSS }));
      shadow.appendChild(host);
      host.appendChild(
        el('div', { class: 'rbs-main' }, [
          el('div', { class: 'rbs-board-area' }, [
            el('div', { class: 'rbs-board-header' }),
            el('div', { class: 'rbs-board-scroll' }, [
              el('div', { class: 'rbs-board-rows' }, [
                el('div', { style: 'padding: 20px; text-align: center; color: #ff6b6b;' },
                  'RBS page changed — controls not found: ' + missing.map((id) => '#' + id).join(', '))
              ])
            ])
          ])
        ])
      );
      return null;
    }
    
    // Build empty shell (topbar will be filled in pass 2, board in pass 3)
    shadow.appendChild(el('style', { text: PANEL_CSS }));
    shadow.appendChild(host);
    
    const main = el('div', { class: 'rbs-main' });
    const boardArea = el('div', { class: 'rbs-board-area' });
    const boardHeader = el('div', { class: 'rbs-board-header' });
    const boardScroll = el('div', { class: 'rbs-board-scroll' });
    const boardRows = el('div', { class: 'rbs-board-rows' });
    
    boardArea.appendChild(boardHeader);
    boardArea.appendChild(boardScroll);
    boardScroll.appendChild(boardRows);
    main.appendChild(boardArea);
    host.appendChild(main);
    
    return {
      host,
      main,
      boardArea,
      boardHeader,
      boardScroll,
      boardRows,
    };
  }

  // ---- top bar -------------------------------------------------------------

  function buildDateChips(startDate, count) {
    const chips = [];
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let i = 0; i < count; i++) {
      const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
      const chip = el('div', {
        class: 'rbs-date-chip',
        'data-date': formatDate(d),
      }, [
        el('div', { class: 'rbs-date-weekday', text: weekdays[d.getDay()] }),
        el('div', { class: 'rbs-date-label', text: formatDate(d) })
      ]);
      chips.push(chip);
    }
    return chips;
  }

  function buildTopBar(shellUI, roomTypes, windowOpts) {
    const topbar = el('div', { class: 'rbs-topbar' });
    
    // Brand
    const brand = el('div', { class: 'rbs-brand' }, [
      el('span', { class: 'rbs-brand-text', text: 'RBS Room Finder' }),
      el('span', { class: 'rbs-brand-building', text: 'E2' }) // TODO: read from #building
    ]);
    topbar.appendChild(brand);
    
    // Building select
    const buildingSelect = el('select');
    // TODO: populate from #building options
    buildingSelect.appendChild(el('option', { value: '', text: 'All buildings' }));
    topbar.appendChild(el('div', { class: 'rbs-control-group' }, [buildingSelect]));
    
    // Room type select
    const typeSelect = el('select');
    typeSelect.appendChild(el('option', { value: '', text: 'All rooms' }));
    for (const t of roomTypes) {
      typeSelect.appendChild(el('option', { value: t, text: t }));
    }
    topbar.appendChild(el('div', { class: 'rbs-control-group' }, [typeSelect]));
    
    // Capacity input
    const capInput = el('input', {
      class: 'rbs-capacity-input',
      type: 'number',
      min: '0',
      placeholder: 'Min cap',
      value: '0'
    });
    topbar.appendChild(el('div', { class: 'rbs-control-group' }, [capInput]));
    
    // Search input
    const searchInput = el('input', {
      class: 'rbs-search-input',
      type: 'search',
      placeholder: 'Search rooms'
    });
    topbar.appendChild(el('div', { class: 'rbs-control-group' }, [searchInput]));
    
    // Date chips
    const dateChips = el('div', { class: 'rbs-date-chips' });
    buildDateChips(new Date(), 14).forEach(chip => dateChips.appendChild(chip));
    topbar.appendChild(dateChips);
    
    // Window controls
    const windowControls = el('div', { class: 'rbs-window-controls' });
    const startSelect = el('select', { class: 'rbs-window-select' });
    const endSelect = el('select', { class: 'rbs-window-select' });
    for (const t of windowOpts.from) startSelect.appendChild(el('option', { value: t, text: t }));
    for (const t of windowOpts.to) endSelect.appendChild(el('option', { value: t, text: t }));
    if (windowOpts.from.includes(DEFAULT_WINDOW.start)) startSelect.value = DEFAULT_WINDOW.start;
    if (windowOpts.to.includes(DEFAULT_WINDOW.end)) endSelect.value = DEFAULT_WINDOW.end;
    windowControls.appendChild(startSelect);
    windowControls.appendChild(el('span', { text: '–' }));
    windowControls.appendChild(endSelect);
    topbar.appendChild(windowControls);
    
    // Sort select
    const sortSelect = el('select', { class: 'rbs-window-select' });
    sortSelect.appendChild(el('option', { value: 'name', text: 'Name' }));
    sortSelect.appendChild(el('option', { value: 'capacity', text: 'Capacity' }));
    topbar.appendChild(el('div', { class: 'rbs-control-group' }, [sortSelect]));
    
    // Action buttons
    const actions = el('div', { class: 'rbs-topbar-actions' });
    const refreshBtn = el('button', {
      class: 'rbs-action-btn',
      text: 'Refresh'
    });
    const nativeBtn = el('button', {
      class: 'rbs-action-btn',
      text: 'Native UI'
    });
    refreshBtn.addEventListener('click', onLoadBoard);
    nativeBtn.addEventListener('click', () => {
      if (document.documentElement.classList.contains('rbsx-native-hidden')) {
        showNativeUI();
        nativeBtn.textContent = 'Hide Native';
      } else {
        hideNativeUI();
        nativeBtn.textContent = 'Show Native';
      }
    });
    actions.appendChild(refreshBtn);
    actions.appendChild(nativeBtn);
    topbar.appendChild(actions);
    
    // Insert at beginning of host
    shellUI.host.insertBefore(topbar, shellUI.host.firstChild);
    
    // Return references
    return {
      topbar,
      buildingSelect,
      typeSelect,
      capInput,
      searchInput,
      dateChips,
      startSelect,
      endSelect,
      sortSelect,
      refreshBtn,
      nativeBtn,
    };
  }

  // ---- board ----------------------------------------------------------------

  function buildHourAxis(axis) {
    const header = ui.boardHeader;
    header.innerHTML = '';
    header.style.gridTemplateColumns = `180px repeat(${axis.length}, 1fr)`;
    
    // Room label column
    header.appendChild(el('div', { class: 'rbs-room-label', text: 'Room' }));
    
    // Hour labels
    for (const label of axis) {
      const isHour = /:00$/.test(label);
      const cell = el('div', {
        class: 'rbs-room-label' + (isHour ? ' rbs-hour' : ''),
        text: isHour ? label : '\u00b7',
        title: label
      });
      header.appendChild(cell);
    }
  }

  function buildRoomRow(room) {
    const row = el('div', {
      class: 'rbs-board-row',
      'data-rsrcid': room.id
    });
    
    // Room info column
    const roomInfo = el('div', { class: 'rbs-room-info' }, [
      el('span', { class: 'rbs-room-code', text: room.name }),
      el('span', { class: 'rbs-room-type', text: room.type || '' }),
      el('span', { class: 'rbs-room-cap', text: String(room.capacity) })
    ]);
    row.appendChild(roomInfo);
    
    // Slot cells (skeleton state)
    const slotCells = el('div', { class: 'rbs-slot-cells' });
    slotCells.style.gridTemplateColumns = `repeat(${board.axis.length}, 1fr)`;
    
    for (let i = 0; i < board.axis.length; i++) {
      const cell = el('div', { class: 'rbs-slot-cell rbs-skel' });
      cell.addEventListener('click', (e) => onCellClick(room.id, i, e));
      slotCells.appendChild(cell);
    }
    
    row.appendChild(slotCells);
    return row;
  }

  function renderBoardSkeleton(rooms) {
    ui.boardRows.innerHTML = '';
    
    // Build hour axis based on current window
    const start = ui.startSelect.value || DEFAULT_WINDOW.start;
    const end = ui.endSelect.value || DEFAULT_WINDOW.end;
    board.axis = buildSlotAxis(start, end);
    buildHourAxis(board.axis);
    
    // Build room rows
    for (const room of rooms) {
      const row = buildRoomRow(room);
      ui.boardRows.appendChild(row);
      board.blocks.set(room.id, {
        rowEl: row,
        cellsEl: row.querySelector('.rbs-slot-cells'),
        cells: Array.from(row.querySelectorAll('.rbs-slot-cell')),
        loaded: false,
        room
      });
    }
    
    board.rooms = rooms;
    board.totalCount = rooms.length;
    board.loadedCount = 0;
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

  // Read the FRESH anti-forgery token before each request.
  function readToken() {
    const input = document.querySelector('input[name=__RequestVerificationToken]');
    return input ? input.value || '' : '';
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

  // ---- slot painting --------------------------------------------------------

  function paintBlock(roomId, slots) {
    const entry = board.blocks.get(roomId);
    if (!entry) return;
    entry.loaded = true;
    const aligned = alignSlots(board.axis, slots);
    const startMin = timeToMinutes(board.form.window.start);
    const endMin = timeToMinutes(board.form.window.end);
    for (let i = 0; i < entry.cells.length; i++) {
      const cell = entry.cells[i];
      const slot = aligned[i];
      const label = board.axis[i];
      cell.className = 'rbs-slot-cell';
      // Dim cells whose START falls outside the chosen window (axis is stable).
      const mins = timeToMinutes(label);
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
      if (outside) cell.classList.add('rbs-outside');
    }
  }

  function markBlockFailed(roomId) {
    const entry = board.blocks.get(roomId);
    if (!entry) return;
    // TODO: show error indicator
  }

  // Count a room as reaching a terminal state (loaded or failed) exactly once.
  function accountRoom(roomId) {
    const entry = board.blocks.get(roomId);
    if (!entry || entry.accounted) return;
    entry.accounted = true;
    board.loadedCount += 1;
  }

  // ---- queue setup ----------------------------------------------------------

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
      { root: ui.boardScroll, threshold: 0.1 }
    );
    for (const entry of board.blocks.values()) {
      board.observer.observe(entry.rowEl);
    }
  }

  function updateProgress() {
    // TODO: implement status bar update
  }

  function finalizeStatus() {
    if (board.observer) { board.observer.disconnect(); board.observer = null; }
    // TODO: implement final status update
  }

  // ---- selection & drawer -------------------------------------------------

  const FORBIDDEN_CLICK_IDS = [
    'btnBookingSave', 'btnConfirmBookingSave', 'btnBookingNext', 'btnBooking',
    'btnBookingMainClear', 'btnMultipleBookingConfirm', 'btnMultipleBookingConfirmSave',
  ];

  const SELECT_CONFIRM_MS = 2500;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let selectedRange = null; // { startCell, endCell, roomId }
  let drawer = null;

  function cssEscape(s) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
    return String(s).replace(/["\\]/g, '\\$&');
  }

  function findNativeCard(rsrcId) {
    const sel = `.cardinfoSingle[data-rsrcid="${cssEscape(rsrcId)}"]`;
    return document.querySelector(sel);
  }

  function detailPopupVisible() {
    const modal = document.getElementById('Modal-detailPopup');
    if (!modal) return false;
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

  function rangeToWindow(startIdx, endIdx) {
    if (startIdx === null || endIdx === null || board.axis.length === 0) return null;
    const s = Math.min(startIdx, endIdx);
    const e = Math.max(startIdx, endIdx);
    return { start: board.axis[s], end: board.axis[e] };
  }

  function rangeHasConflict(startIdx, endIdx, roomId) {
    const entry = board.blocks.get(roomId);
    if (!entry || !entry.loaded) return false;
    const s = Math.min(startIdx, endIdx);
    const e = Math.max(startIdx, endIdx);
    for (let i = s; i <= e; i++) {
      const cell = entry.cells[i];
      if (cell.classList.contains('rbs-taken')) return true;
    }
    return false;
  }

  async function bookRoom(room) {
    const card = findNativeCard(room.id);
    if (!card) return { ok: false, reason: 'card-not-found' };

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

  function buildDrawer() {
    const drawerEl = el('div', { class: 'rbs-drawer' });
    const header = el('div', { class: 'rbs-drawer-header' }, [
      el('div', { class: 'rbs-drawer-title', text: 'Selected slots' }),
      el('button', { class: 'rbs-drawer-toggle', text: '×' })
    ]);
    const content = el('div', { class: 'rbs-drawer-content' });
    drawerEl.appendChild(header);
    drawerEl.appendChild(content);
    return { drawerEl, content };
  }

  function updateDrawer(room, range) {
    if (!drawer) {
      drawer = buildDrawer();
      ui.main.appendChild(drawer.drawerEl);
    }
    
    const window = rangeToWindow(range.startIdx, range.endIdx);
    const conflict = rangeHasConflict(range.startIdx, range.endIdx, room.id);
    
    drawer.content.innerHTML = '';
    
    const roomInfo = el('div', { class: 'rbs-selected-room' }, [
      el('div', { class: 'rbs-room-title', text: room.name }),
      el('div', { class: 'rbs-room-subtitle', text: room.type || '' }),
      el('div', { class: 'rbs-room-subtitle', text: `Capacity: ${room.capacity}` })
    ]);
    
    const windowInfo = el('div', { class: 'rbs-window-info' }, [
      el('div', { class: 'rbs-window-label', text: 'Selected window' }),
      el('div', { class: 'rbs-window-value', text: `${window.start} – ${window.end}` }),
      el('div', { class: 'rbs-slot-count', text: `${Math.abs(range.endIdx - range.startIdx) + 1} slot(s)` })
    ]);
    
    const actions = el('div', { class: 'rbs-drawer-actions' }, [
      el('button', { 
        class: 'rbs-drawer-btn rbs-primary',
        text: 'Book on native form'
      }),
      el('button', { 
        class: 'rbs-drawer-btn rbs-secondary',
        text: 'Clear'
      })
    ]);
    
    drawer.content.appendChild(roomInfo);
    drawer.content.appendChild(windowInfo);
    
    if (conflict) {
      const conflictNote = el('div', { class: 'rbs-conflict-note' }, [
        'Selected range contains taken slots'
      ]);
      drawer.content.appendChild(conflictNote);
    }
    
    drawer.content.appendChild(actions);
  }

  function clearSelection() {
    if (selectedRange) {
      // Clear visual selection
      const entry = board.blocks.get(selectedRange.roomId);
      if (entry) {
        for (let i = selectedRange.startIdx; i <= selectedRange.endIdx; i++) {
          entry.cells[i]?.classList.remove('rbs-selected');
        }
      }
      selectedRange = null;
    }
    if (drawer) {
      drawer.drawerEl.remove();
      drawer = null;
    }
  }

  // ---- cell click handling -------------------------------------------------

  function onCellClick(roomId, cellIdx, event) {
    const entry = board.blocks.get(roomId);
    if (!entry) return;
    
    if (event.shiftKey && selectedRange) {
      // Extend selection
      const newRange = {
        roomId,
        startIdx: Math.min(selectedRange.startIdx, cellIdx),
        endIdx: Math.max(selectedRange.endIdx, cellIdx)
      };
      
      // Clear old selection
      for (let i = selectedRange.startIdx; i <= selectedRange.endIdx; i++) {
        entry.cells[i]?.classList.remove('rbs-selected');
      }
      
      // Apply new selection
      for (let i = newRange.startIdx; i <= newRange.endIdx; i++) {
        entry.cells[i]?.classList.add('rbs-selected');
      }
      
      selectedRange = newRange;
      updateDrawer(entry.room, newRange);
    } else {
      // New selection
      clearSelection();
      
      entry.cells[cellIdx]?.classList.add('rbs-selected');
      selectedRange = { roomId, startIdx: cellIdx, endIdx: cellIdx };
      updateDrawer(entry.room, selectedRange);
    }
  }

  // ---- status bar ----------------------------------------------------------

  function buildStatusBar() {
    const statusbar = el('div', { class: 'rbs-statusbar' });
    const stats = el('div', { class: 'rbs-stats' });
    const errorIndicator = el('div', { class: 'rbs-error-indicator' });
    
    stats.appendChild(el('span', { id: 'rbs-stats-text', text: '0/0 rooms loaded · 0 requests in flight' }));
    errorIndicator.appendChild(el('span', { id: 'rbs-error-text' }));
    errorIndicator.appendChild(el('span', { class: 'rbs-retry-link', text: 'retry' }));
    
    statusbar.appendChild(stats);
    statusbar.appendChild(errorIndicator);
    
    ui.host.appendChild(statusbar);
    return { statusbar, stats, errorIndicator };
  }

  // ---- hide/toggle native UI ------------------------------------------------

  const NATIVE_HIDE_SELECTORS = [
    '#ctl00_MainContent_SearchTopBar',
    '#ctl00_MainContent_SearchBar',
    '#ctl00_MainContent_SearchPanel',
    '#ctl00_MainContent_ListViewPanel',
    '.searchresult',
    '.searchresultheader',
    '.searchresultfooter',
    '#ctl00_MainContent_PagingTop',
    '#ctl00_MainContent_PagingBottom',
    '#ctl00_MainContent_DetailPanel',
    '#ctl00_MainContent_DetailInfoPanel',
    '#ctl00_MainContent_BookingPanel',
    '#ctl00_MainContent_BookingInfoPanel',
  ];

  function hideNativeUI() {
    const style = el('style', { id: 'rbs-native-hide' });
    style.textContent = NATIVE_HIDE_SELECTORS.map(sel => `${sel} { display: none !important; }`).join('\n');
    document.head.appendChild(style);
    document.documentElement.classList.add('rbsx-native-hidden');
  }

  function showNativeUI() {
    const style = document.getElementById('rbs-native-hide');
    if (style) style.remove();
    document.documentElement.classList.remove('rbsx-native-hidden');
  }

  // ---- keyboard shortcuts ---------------------------------------------------

  function keyToAction(event) {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT' || event.target.tagName === 'TEXTAREA') {
      return null;
    }
    
    switch (event.key) {
      case '/':
        event.preventDefault();
        ui.searchInput?.focus();
        return 'focus-search';
      case 'j':
      case 'ArrowDown':
        // TODO: navigate down
        return 'navigate-down';
      case 'k':
      case 'ArrowUp':
        // TODO: navigate up
        return 'navigate-up';
      case 'Enter':
        // TODO: open drawer/book
        return 'select';
      case 'd':
        // TODO: toggle drawer
        return 'toggle-drawer';
      case 'Escape':
        clearSelection();
        return 'clear';
      default:
        return null;
    }
  }

  // ---- fallback detection ---------------------------------------------------

  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;

  function shouldRevealNative() {
    return consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
  }

  function showFallbackBanner() {
    const banner = el('div', { class: 'rbs-fallback-banner' }, [
      el('span', { text: 'RBS Room Finder failed repeatedly — showing native interface.' }),
      el('button', { class: 'rbs-fallback-close', text: '×' })
    ]);
    document.body.appendChild(banner);
    
    banner.querySelector('.rbs-fallback-close').addEventListener('click', () => {
      banner.remove();
    });
    
    return banner;
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
    if (form.date) {
      // Select date chip
      const chip = ui.dateChips.querySelector(`[data-date="${form.date}"]`);
      if (chip) {
        ui.dateChips.querySelectorAll('.rbs-date-chip').forEach(c => c.classList.remove('rbs-selected'));
        chip.classList.add('rbs-selected');
      }
    }
    if (form.window) {
      if (form.window.start && windowOpts.from.includes(form.window.start)) ui.startSelect.value = form.window.start;
      if (form.window.end && windowOpts.to.includes(form.window.end)) ui.endSelect.value = form.window.end;
    }
    if (form.minCapacity != null) ui.capInput.value = String(form.minCapacity);
    if (form.sort) ui.sortSelect.value = form.sort;
  }

  // ---- main Load board flow ------------------------------------------------

  async function onLoadBoard() {
    // Read form from UI
    const form = {
      roomType: ui.typeSelect.value,
      date: ui.dateChips.querySelector('.rbs-date-chip.rbs-selected')?.dataset.date || formatDate(new Date()),
      window: { start: ui.startSelect.value, end: ui.endSelect.value },
      minCapacity: Number(ui.capInput.value) || 0,
      sort: ui.sortSelect.value,
    };

    // Validate the window.
    const sMin = timeToMinutes(form.window.start);
    const eMin = timeToMinutes(form.window.end);
    if (isNaN(sMin) || isNaN(eMin) || eMin <= sMin) {
      // TODO: show error
      return;
    }

    // A new load bumps the generation: any in-flight queue is abandoned.
    board.generation += 1;
    if (board.queue) board.queue.bumpGeneration();

    board.form = form;
    board.blocks = new Map();
    board.loadedCount = 0;
    if (board.observer) { board.observer.disconnect(); board.observer = null; }

    let rooms;
    try {
      rooms = await fetchRooms(form);
    } catch (e) {
      // TODO: show error
      return;
    }

    const roomsFromSearch = rooms.length;
    const filtered = rooms.filter((r) => r.capacity >= form.minCapacity);
    const ordered = sortRooms(filtered, form.sort);
    
    if (ordered.length === 0) {
      // TODO: show no rooms message
      return;
    }

    // Render skeleton
    renderBoardSkeleton(ordered);

    // Build the single-flight queue
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
      },
      onError: (roomId, err) => {
        if (board.generation !== myGen) return;
        markBlockFailed(roomId);
        accountRoom(roomId);
        updateProgress();
      },
    });

    board.queue.enqueue(ordered);
    setupObserver();
    
    board.queue.run().then(() => {
      if (board.generation !== myGen) return;
      finalizeStatus();
    });
  }

  // ---- sorting --------------------------------------------------------------

  function sortRooms(rooms, sort) {
    const list = rooms.slice();
    if (sort === 'capacity') {
      list.sort((a, b) => b.capacity - a.capacity || a.name.localeCompare(b.name));
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }

  // ---- init -----------------------------------------------------------------

  async function initSearchPage() {
    const missing = missingControlIds();
    const hostEl = el('div', { id: 'rbs-room-finder-host' });
    document.body.appendChild(hostEl);
    const shadow = hostEl.attachShadow({ mode: 'open' });
    
    const shellUI = buildFullPageShell(shadow, missing);
    if (!shellUI) return; // gate failed
    
    // Build top bar (Pass 2)
    const roomTypes = readRoomTypes();
    const windowOpts = readWindowOptions();
    const topBar = buildTopBar(shellUI, roomTypes, windowOpts);
    
    // Build status bar (Pass 5)
    const statusBar = buildStatusBar();
    
    // Combine UI references and set global ui
    ui = { ...shellUI, ...topBar, ...statusBar };
    
    // Hide native UI by default
    hideNativeUI();
    
    // Add keyboard listeners
    document.addEventListener('keydown', (e) => {
      const action = keyToAction(e);
      if (action) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    
    // Restore last search (but don't auto-run)
    const last = await loadLast();
    if (last) applyForm(last, roomTypes, windowOpts);
    
    return ui;
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
    if (isSearchPage()) initSearchPage();
    else initLauncher();
  }

  init();
})();