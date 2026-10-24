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
  // The axis the board always draws; the user's window only dims cells outside it.
  const DAY_WINDOW = Object.freeze({ start: '07:00', end: '22:30' });
  const PANEL_CSS = `:host{all:initial}
  
  /* RBS theme variables */
  :host {
    --rbs-page: #0b0c0e;
    --rbs-surface: #14161a;
    --rbs-surface2: #1f2226;
    --rbs-border: #2b2f36;
    --rbs-border-hour: #3a3f48;
    --rbs-primary-text: #e6e8eb;
    --rbs-muted: #8b9199;
    --rbs-accent: #c8102e; /* SIT red */
    --rbs-free: #2dd4bf;
    --rbs-taken: #b45309;
    --rbs-closed: #2a2d33;
    --rbs-font: -apple-system, "Segoe UI", system-ui, sans-serif;
    --rbs-font-mono: ui-monospace, "SF Mono", Monaco, "Cascadia Mono", monospace;
    --rbs-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    --rbs-gap: 12px;
    --rbs-radius: 8px;
    --rbs-cell-size: 32px;
    --rbs-hour-height: 40px;
    --rbs-row-height: 34px;
    --rbs-topbar-height: 64px;
    --rbs-status-height: 24px;
    
    /* Shoelace theme mapping */
    --sl-color-primary-50: #fef2f2;
    --sl-color-primary-100: #fee2e2;
    --sl-color-primary-200: #fecaca;
    --sl-color-primary-300: #fca5a5;
    --sl-color-primary-400: #f87171;
    --sl-color-primary-500: #ef4444;
    --sl-color-primary-600: var(--rbs-accent); /* #c8102e */
    --sl-color-primary-700: #b91c1c;
    --sl-color-primary-800: #991b1b;
    --sl-color-primary-900: #7f1d1d;
    --sl-color-primary-950: #450a0a;
    
    --sl-color-neutral-50: #f9fafb;
    --sl-color-neutral-100: #f3f4f6;
    --sl-color-neutral-200: #e5e7eb;
    --sl-color-neutral-300: #d1d5db;
    --sl-color-neutral-400: #9ca3af;
    --sl-color-neutral-500: #6b7280;
    --sl-color-neutral-600: #4b5563;
    --sl-color-neutral-700: #374151;
    --sl-color-neutral-800: #1f2937;
    --sl-color-neutral-900: #111827;
    --sl-color-neutral-950: #030712;
    
    --sl-color-neutral-0: var(--rbs-page);
    --sl-color-neutral-1000: var(--rbs-primary-text);
    
    --sl-font-sans: var(--rbs-font);
    --sl-font-mono: var(--rbs-font-mono);
    --sl-border-radius-small: 4px;
    --sl-border-radius-medium: var(--rbs-radius);
    --sl-border-radius-large: 12px;
    --sl-border-radius-x-large: 16px;
    
    --sl-input-height-small: 28px;
    --sl-input-height-medium: 32px;
    --sl-input-height-large: 40px;
    
    --sl-panel-background-color: var(--rbs-surface);
    --sl-panel-border-color: var(--rbs-border);
    
    --sl-input-background-color: var(--rbs-surface2);
    --sl-input-border-color: var(--rbs-border);
    --sl-input-color: var(--rbs-primary-text);
    --sl-input-placeholder-color: var(--rbs-muted);
    
    --sl-button-small-font-size: 12px;
    --sl-button-font-size-small: 12px;
    
    --sl-focus-ring-color: var(--rbs-accent);
    --sl-focus-ring-style: solid;
    --sl-focus-ring-width: 2px;
  }
  
  :host([data-theme="light"]) {
    --rbs-page: #ffffff;
    --rbs-surface: #f8f9fa;
    --rbs-surface2: #e9ecef;
    --rbs-border: #dee2e6;
    --rbs-border-hour: #ced4da;
    --rbs-primary-text: #212529;
    --rbs-muted: #6c757d;
    --rbs-accent: #0d6efd;
    --rbs-free: #198754;
    --rbs-taken: #dc3545;
    
    /* Light theme Shoelace overrides */
    --sl-color-primary-600: var(--rbs-accent);
    --sl-color-neutral-0: var(--rbs-page);
    --sl-color-neutral-1000: var(--rbs-primary-text);
    --sl-panel-background-color: var(--rbs-surface);
    --sl-panel-border-color: var(--rbs-border);
    --sl-input-background-color: var(--rbs-surface2);
    --sl-input-border-color: var(--rbs-border);
    --sl-input-color: var(--rbs-primary-text);
    --sl-input-placeholder-color: var(--rbs-muted);
  }
  
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
  
  .rbs-fullpage {
    position: fixed;
    inset: 0;
    z-index: 2147483000;
    display: flex;
    flex-direction: column;
    background: var(--rbs-page);
    color: var(--rbs-primary-text);
    font-family: var(--rbs-font);
    font-size: 13px;
    line-height: 1.4;
    overflow: hidden;
  }
  
  .rbs-topbar {
    height: var(--rbs-topbar-height);
    display: flex;
    align-items: center;
    padding: 0 var(--rbs-gap);
    background: var(--rbs-surface);
    border-bottom: 1px solid var(--rbs-border);
    gap: var(--rbs-gap);
    flex-shrink: 0;
  }
  
  .rbs-brand {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    color: var(--rbs-accent);
    margin-right: 12px;
  }
  
  .rbs-brand-text {
    font-size: 14px;
  }
  
  .rbs-brand-building {
    font-size: 13px;
    color: var(--rbs-primary-text);
    margin-left: 4px;
  }
  
  .rbs-control-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .rbs-control-group select,
  .rbs-control-group input {
    background: var(--rbs-surface2);
    border: 1px solid var(--rbs-border);
    color: var(--rbs-primary-text);
    border-radius: var(--rbs-radius);
    padding: 6px 8px;
    font-size: 12px;
    min-height: 28px;
    appearance: none;
    -webkit-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238b9199' d='M2.5 4.5L6 8l3.5-3.5H2.5z'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 8px center;
    padding-right: 28px;
  }
  
  .rbs-control-group select:focus,
  .rbs-control-group input:focus {
    outline: 2px solid var(--rbs-accent);
    outline-offset: 0;
  }
  
  .rbs-control-group select option {
    background: var(--rbs-surface2);
    color: var(--rbs-primary-text);
  }
  
  .rbs-capacity-input {
    width: 80px;
  }
  
  .rbs-search-input {
    width: 120px;
  }
  
  .rbs-date-chips {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    padding: 2px;
    scrollbar-width: none;
  }
  
  .rbs-date-chip {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 6px 8px;
    background: var(--rbs-surface2);
    border: 1px solid var(--rbs-border);
    border-radius: var(--rbs-radius);
    min-width: 70px;
    cursor: pointer;
    user-select: none;
  }
  
  .rbs-date-chip:hover {
    background: var(--rbs-surface);
  }
  
  .rbs-date-chip.rbs-selected {
    background: var(--rbs-accent);
    color: white;
    border-color: var(--rbs-accent);
    font-weight: 600;
    outline: 2px solid var(--rbs-accent);
    outline-offset: -1px;
  }
  
  .rbs-date-weekday {
    font-size: 10px;
    font-weight: 600;
    margin-bottom: 2px;
  }
  
  .rbs-date-label {
    font-size: 11px;
  }
  
  .rbs-window-controls {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  
  .rbs-window-select {
    width: 88px;
  }
  
  .rbs-topbar-actions {
    margin-left: auto;
    display: flex;
    gap: 8px;
  }
  
  .rbs-action-btn {
    background: var(--rbs-surface2);
    border: 1px solid var(--rbs-border);
    color: var(--rbs-primary-text);
    border-radius: var(--rbs-radius);
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
    min-height: 28px;
    white-space: nowrap;
    min-width: 60px;
  }
  
  .rbs-action-btn:hover {
    background: var(--rbs-surface);
  }
  
  .rbs-action-btn.rbs-primary {
    background: var(--rbs-accent);
    color: white;
    border-color: var(--rbs-accent);
  }
  
  .rbs-action-btn.rbs-primary:hover {
    background: #d93046;
  }
  
  .rbs-main {
    flex: 1;
    display: flex;
    overflow: hidden;
    position: relative;
  }
  
  .rbs-board-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  
  .rbs-board-header {
    height: var(--rbs-hour-height);
    background: var(--rbs-surface);
    border-bottom: 1px solid var(--rbs-border);
    display: grid;
    align-items: center;
    position: sticky;
    top: 0;
    z-index: 10;
  }
  
  .rbs-hour-last {
    font-size: 10px;
    color: var(--rbs-muted);
  }
  
  .rbs-room-label {
    padding: 0 12px;
    font-family: var(--rbs-font-mono);
    font-size: 12px;
    color: var(--rbs-muted);
    border-right: 1px solid var(--rbs-border);
  }
  
  .rbs-board-scroll {
    flex: 1;
    overflow: auto;
    background-image: repeating-linear-gradient(to bottom, transparent 0 31px, var(--rbs-border) 31px 32px);
  }
  
  .rbs-board-rows {
    display: flex;
    flex-direction: column;
  }
  
  .rbs-board-row.rbs-row-odd .rbs-room-info {
    background: rgba(255, 255, 255, 0.04);
  }
  
  .rbs-board-row.rbs-row-odd .rbs-slot-cell.rbs-unknown,
  .rbs-board-row.rbs-row-odd .rbs-slot-cell.rbs-closed {
    background-color: rgba(255, 255, 255, 0.035);
  }
  
  .rbs-board-row.rbs-row-odd .rbs-slot-cell.rbs-free {
    box-shadow: inset 0 0 0 999px rgba(255, 255, 255, 0.05);
  }
  
  .rbs-board-row.rbs-row-odd .rbs-slot-cell.rbs-taken {
    box-shadow: inset 0 0 0 999px rgba(0, 0, 0, 0.12);
  }
  
  .rbs-board-row:hover .rbs-room-info {
    background: rgba(255, 255, 255, 0.06);
  }
  
  .rbs-slot-cell:hover {
    outline: 1px solid var(--rbs-accent);
    outline-offset: -1px;
  }
  
  .rbs-board-row {
    height: var(--rbs-row-height);
    display: grid;
    align-items: center;
    border-bottom: 1px solid var(--rbs-border);
  }
  
  .rbs-room-info {
    display: flex;
    align-items: center;
    padding: 0 8px;
    gap: 5px;
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    border-right: 1px solid var(--rbs-border);
  }
  
  .rbs-room-code {
    font-family: var(--rbs-font-mono);
    color: var(--rbs-primary-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.1;
    flex: 1 1 auto;
    font-size: 11px;
    letter-spacing: -0.2px;
  }
  
  .rbs-room-type {
    color: var(--rbs-muted);
    font-size: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 88px;
  }
  
  .rbs-room-cap {
    background: var(--rbs-surface2);
    color: var(--rbs-primary-text);
    border-radius: 999px;
    padding: 0 6px;
    font-size: 10px;
    font-weight: 600;
    margin-left: auto;
  }
  
  .rbs-slot-cells {
    display: grid;
    gap: 1px;
    height: 100%;
    align-items: center;
  }
  
  .rbs-slot-cell {
    height: 100%;
    border-right: 1px solid var(--rbs-border);
  }
  
  .rbs-slot-cell.rbs-hour-boundary {
    border-right-color: var(--rbs-border-hour);
  }
  
  .rbs-slot-cell.rbs-free {
    background: var(--rbs-free);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25);
  }
  
  .rbs-slot-cell.rbs-taken {
    background-color: var(--rbs-taken);
    background-image: repeating-linear-gradient(
      45deg,
      rgba(0, 0, 0, 0.28) 0 3px,
      transparent 3px 6px
    );
  }
  
  .rbs-slot-cell.rbs-unknown {
    background: var(--rbs-surface2);
  }
  
  .rbs-slot-cell.rbs-outside {
    opacity: 0.3;
  }
  
  .rbs-slot-cell.rbs-selected {
    outline: 2px solid var(--rbs-accent);
    outline-offset: -1px;
    z-index: 1;
  }
  
  .rbs-slot-cell.rbs-skel {
    background: linear-gradient(90deg, var(--rbs-surface2) 25%, var(--rbs-surface) 37%, var(--rbs-surface2) 63%);
    background-size: 400% 100%;
    animation: rbs-shimmer 1.2s ease-in-out infinite;
  }
  
  @keyframes rbs-shimmer {
    0% {
      background-position: 100% 0;
    }
    100% {
      background-position: 0 0;
    }
  }
  
  .rbs-statusbar {
    height: var(--rbs-status-height);
    background: var(--rbs-surface);
    border-top: 1px solid var(--rbs-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    font-family: var(--rbs-font-mono);
    font-size: 11px;
    color: var(--rbs-muted);
    flex-shrink: 0;
    overflow: hidden;
    white-space: nowrap;
  }
  
  .rbs-stats {
    display: flex;
    gap: 12px;
  }
  
  .rbs-error-indicator {
    color: #ff6b6b;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  
  .rbs-retry-btn {
    background: none;
    border: none;
    color: var(--rbs-accent);
    cursor: pointer;
    text-decoration: underline;
    font-family: inherit;
    font-size: inherit;
    padding: 0;
    margin: 0;
  }
  
  .rbs-legend {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
    margin-right: 12px;
    font-size: 11px;
    color: var(--rbs-muted);
  }
  
  .rbs-legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  
  .rbs-legend-dot.rbs-free-dot {
    background-color: var(--rbs-free);
  }
  
  .rbs-legend-dot.rbs-closed-dot {
    background-color: var(--rbs-closed);
    border: 1px solid var(--rbs-border);
  }
  
  .rbs-legend-swatch {
    width: 14px;
    height: 10px;
    border-radius: 2px;
    display: inline-block;
  }
  
  .rbs-legend-swatch.rbs-free-swatch {
    background: var(--rbs-free);
  }
  
  .rbs-legend-swatch.rbs-taken-swatch {
    background-color: var(--rbs-taken);
    background-image: repeating-linear-gradient(45deg, rgba(0,0,0,.28) 0 3px, transparent 3px 6px);
  }
  
  .rbs-legend-swatch.rbs-closed-swatch {
    background: var(--rbs-closed);
    border: 1px solid var(--rbs-border);
  }
  
  .rbs-legend-dot.rbs-taken-dot {
    background-color: var(--rbs-taken);
  }
  
  @media (max-width: 1279px) {
    .rbs-topbar {
      flex-wrap: wrap;
      height: auto;
      padding: 8px;
    }
    
    .rbs-date-chips {
      order: 1;
      width: 100%;
      margin-top: 8px;
    }
  }
  
  .rbs-fullpage.rbs-app-hidden {
    display: none !important;
  }
  
  /* Shoelace component customizations */
  sl-select[size="small"] {
    --sl-input-height-small: 28px;
    --sl-input-font-size-small: 12px;
  }
  
  sl-input[size="small"] {
    --sl-input-height-small: 28px;
    --sl-input-font-size-small: 12px;
  }
  
  sl-button[size="small"] {
    --sl-button-font-size-small: 12px;
  }
  
  .rbs-shoelace-fallback {
    padding: 4px 8px;
    background: var(--rbs-surface2);
    border: 1px solid var(--rbs-border);
    border-radius: var(--rbs-radius);
    font-size: 11px;
    color: var(--rbs-muted);
    text-align: center;
  }`;

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
    NATIVE_HIDE_SELECTORS,
    shouldRevealNativeOnFailure,
    rangeToWindow,
    filterRooms,
    axisGridTemplate,
    buildAxisHeaderCells,
    hasShoelace,
    defaultForm,
    queueStatus,
  } = N;

  // Global UI references
  let ui = null;
  
  // Safer UI access with guard
  function getUI() {
    if (!ui) {
      renderFatal('UI not initialized');
      throw new Error('UI not initialized');
    }
    return ui;
  }

  // Guard: if native.js failed to load, do nothing rather than throw on page.
  if (typeof buildSearchPayload !== 'function' || typeof createSlotQueue !== 'function') {
    return;
  }

  // ---- utilities ------------------------------------------------------------

  function isSearchPage() {
    return location.pathname.indexOf(SEARCH_PATH) !== -1;
  }

  function el(tag, props, children) {
    // Shoelace's sl-select only understands <sl-option> children; a plain <option>
    // is ignored, which left every select empty after the Shoelace migration.
    const realTag = tag === 'option' && hasShoelace() ? 'sl-option' : tag;
    const node = document.createElement(realTag);
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

  // Helper for creating Shoelace components with fallback
  function createControl(tag, props, children, fallbackTag = 'div') {
    const useShoelace = hasShoelace();
    const element = useShoelace ? document.createElement(tag) : document.createElement(fallbackTag);
    
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === 'class') {
          element.className = v;
        } else if (k === 'text') {
          if (useShoelace && tag.startsWith('sl-')) {
            element.textContent = v;
          } else {
            element.textContent = v;
          }
        } else if (k === 'value' && useShoelace && tag.startsWith('sl-')) {
          element.value = v;
        } else if (k === 'placeholder' && useShoelace && tag.startsWith('sl-')) {
          element.placeholder = v;
        } else if (k === 'type' && useShoelace && tag.startsWith('sl-')) {
          element.type = v;
        } else if (k === 'size' && useShoelace && tag.startsWith('sl-')) {
          element.size = v;
        } else if (k === 'variant' && useShoelace && tag.startsWith('sl-')) {
          element.variant = v;
        } else if (k === 'clearable' && useShoelace && tag.startsWith('sl-')) {
          element.clearable = v;
        } else if (k === 'hoist' && useShoelace && tag.startsWith('sl-')) {
          element.hoist = v;
        } else if (k === 'label' && useShoelace && tag.startsWith('sl-')) {
          element.setAttribute('label', v);
        } else if (k === 'pill' && useShoelace && tag.startsWith('sl-')) {
          element.pill = v;
        } else if (k.startsWith('on') && typeof v === 'function') {
          const eventName = k.slice(2).toLowerCase();
          element.addEventListener(eventName, v);
        } else if (v != null) {
          element.setAttribute(k, v);
        }
      }
    }
    
    if (children) {
      for (const c of [].concat(children)) {
        if (c == null) continue;
        if (typeof c === 'string') {
          element.appendChild(document.createTextNode(c));
        } else if (c instanceof HTMLElement || c instanceof SVGElement) {
          element.appendChild(c);
        }
      }
    }
    
    return element;
  }

  // Read the option elements of a control regardless of whether it is a
  // Shoelace <sl-select> (children are <sl-option>) or a plain <select>
  // (children are <option> exposed via .options). On the plain-HTML path a
  // blind querySelectorAll('sl-option') returns [], which silently collapsed
  // the concrete room type to "All rooms" (~60 rooms). Route every option
  // read through here so both control kinds behave the same.
  function readControlOptions(control) {
    if (!control) return [];
    if (control.tagName === 'SL-SELECT') {
      return Array.from(control.querySelectorAll('sl-option'));
    }
    return Array.from(control.options || control.querySelectorAll('option') || []);
  }

  // Merge select options preserving current selection
  function mergeSelectOptions(existingOptions, newOptions, currentValue) {
    // existingOptions: array of current option values
    // newOptions: array of new option values
    // currentValue: currently selected value
    
    // If current value exists in new options, keep it
    if (newOptions.includes(currentValue)) {
      return { options: newOptions, value: currentValue };
    }
    
    // Otherwise fall back to appropriate default
    if (currentValue === '') {
      // "All rooms" or empty - keep empty if available, otherwise first
      return { options: newOptions, value: '' };
    } else {
      // Specific value no longer available - fall back to first option
      return { options: newOptions, value: newOptions.length > 0 ? newOptions[0] : '' };
    }
  }

  // Debounce helper
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
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

  // Read building name from the selected building option
  function readBuildingName() {
    const buildingSelect = document.getElementById(RBS_CONTROL_IDS.building);
    if (!buildingSelect) return '';
    
    const selectedOption = buildingSelect.options[buildingSelect.selectedIndex];
    if (!selectedOption) return '';
    
    const text = selectedOption.textContent.trim();
    if (!text || /^-+$/.test(text) || /please select/i.test(text)) {
      return '';
    }
    
    // Extract building code (e.g., "E2" from "E2 - Engineering Block 2")
    const match = text.match(/^([A-Z0-9]+)/);
    return match ? match[1] : text.split(' ')[0];
  }

  // Update room type and window selects based on current building
  function updateTypeAndWindowSelects(typeSelect, startSelect, endSelect) {
    if (!typeSelect || !startSelect || !endSelect) return;
    
    // Read fresh room types and window options
    const roomTypes = readRoomTypes();
    const windowOpts = readWindowOptions();
    
    // Check if using Shoelace
    const isShoelace = typeSelect.tagName === 'SL-SELECT';
    
    // Update room type select
    const currentTypeValue = typeSelect.value;
    const existingTypeOptions = isShoelace 
      ? Array.from(typeSelect.querySelectorAll('sl-option')).map(opt => opt.value)
      : Array.from(typeSelect.options).map(opt => opt.value);
    const typeResult = mergeSelectOptions(existingTypeOptions, roomTypes, currentTypeValue);
    
    if (isShoelace) {
      // Clear and rebuild sl-options
      typeSelect.innerHTML = '';
      const allOption = createControl('sl-option', { value: '', text: 'All rooms' }, null, 'option');
      typeSelect.appendChild(allOption);
      for (const t of typeResult.options) {
        const option = createControl('sl-option', { value: t, text: t }, null, 'option');
        typeSelect.appendChild(option);
      }
      typeSelect.value = typeResult.value;
    } else {
      typeSelect.innerHTML = '';
      typeSelect.appendChild(el('option', { value: '', text: 'All rooms' }));
      for (const t of typeResult.options) {
        typeSelect.appendChild(el('option', { value: t, text: t }));
      }
      typeSelect.value = typeResult.value;
    }
    
    // Update window start select
    const currentStartValue = startSelect.value;
    const existingStartOptions = isShoelace
      ? Array.from(startSelect.querySelectorAll('sl-option')).map(opt => opt.value)
      : Array.from(startSelect.options).map(opt => opt.value);
    const startResult = mergeSelectOptions(existingStartOptions, windowOpts.from, currentStartValue);
    
    if (isShoelace) {
      startSelect.innerHTML = '';
      for (const t of startResult.options) {
        const option = createControl('sl-option', { value: t, text: t }, null, 'option');
        startSelect.appendChild(option);
      }
      startSelect.value = startResult.value;
    } else {
      startSelect.innerHTML = '';
      for (const t of startResult.options) {
        startSelect.appendChild(el('option', { value: t, text: t }));
      }
      startSelect.value = startResult.value;
    }
    
    // Update window end select
    const currentEndValue = endSelect.value;
    const existingEndOptions = isShoelace
      ? Array.from(endSelect.querySelectorAll('sl-option')).map(opt => opt.value)
      : Array.from(endSelect.options).map(opt => opt.value);
    const endResult = mergeSelectOptions(existingEndOptions, windowOpts.to, currentEndValue);
    
    if (isShoelace) {
      endSelect.innerHTML = '';
      for (const t of endResult.options) {
        const option = createControl('sl-option', { value: t, text: t }, null, 'option');
        endSelect.appendChild(option);
      }
      endSelect.value = endResult.value;
    } else {
      endSelect.innerHTML = '';
      for (const t of endResult.options) {
        endSelect.appendChild(el('option', { value: t, text: t }));
      }
      endSelect.value = endResult.value;
    }
  }

  // Populate building select from the live cascade
  async function populateBuildingSelect(buildingSelect, typeSelect, startSelect, endSelect) {
    const nativeBuildingSelect = document.getElementById(RBS_CONTROL_IDS.building);
    if (!nativeBuildingSelect) {
      buildingSelect.disabled = true;
      buildingSelect.innerHTML = '';
      buildingSelect.appendChild(el('option', { value: '', text: 'Building…' }));
      return;
    }
    
    // Read current options
    const options = Array.from(nativeBuildingSelect.options)
      .map(opt => ({ value: opt.value, text: opt.textContent.trim() }))
      .filter(opt => opt.text && !/^-+$/.test(opt.text) && !/please select/i.test(opt.text));
    
    if (options.length >= 2) {
      // We have real building options
      buildingSelect.innerHTML = '';
      buildingSelect.appendChild(el('option', { value: '', text: 'All buildings' }));
      options.forEach(opt => {
        buildingSelect.appendChild(el('option', { 
          value: opt.value, 
          text: opt.text 
        }));
      });
      buildingSelect.disabled = false;
      
      // Update room type and window selects since building is now populated
      if (typeSelect && startSelect && endSelect) {
        updateTypeAndWindowSelects(typeSelect, startSelect, endSelect);
      }
    } else {
      // Building select is empty - need to trigger cascade
      buildingSelect.disabled = true;
      buildingSelect.innerHTML = '';
      buildingSelect.appendChild(el('option', { value: '', text: 'Building…' }));
      
      // Try to trigger campus change to populate building
      const campusSelect = document.getElementById(RBS_CONTROL_IDS.campus);
      if (campusSelect && campusSelect.options.length > 1) {
        // Select first non-placeholder campus option
        const realOptions = Array.from(campusSelect.options)
          .filter(opt => opt.text.trim() && !/^-+$/.test(opt.text.trim()) && !/please select/i.test(opt.text.trim()));
        
        if (realOptions.length > 0 && campusSelect.value !== realOptions[0].value) {
          campusSelect.value = realOptions[0].value;
          campusSelect.dispatchEvent(new Event('change', { bubbles: true }));
          
          // Wait for cascade to populate building
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Re-read building options
          const newOptions = Array.from(nativeBuildingSelect.options)
            .map(opt => ({ value: opt.value, text: opt.textContent.trim() }))
            .filter(opt => opt.text && !/^-+$/.test(opt.text) && !/please select/i.test(opt.text));
          
          if (newOptions.length >= 2) {
            buildingSelect.innerHTML = '';
            buildingSelect.appendChild(el('option', { value: '', text: 'All buildings' }));
            newOptions.forEach(opt => {
              buildingSelect.appendChild(el('option', { 
                value: opt.value, 
                text: opt.text 
              }));
            });
            buildingSelect.disabled = false;
            
            // Update room type and window selects since building is now populated
            if (typeSelect && startSelect && endSelect) {
              updateTypeAndWindowSelects(typeSelect, startSelect, endSelect);
            }
          }
        }
      }
    }
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

  // ---- fatal error rendering -----------------------------------------------

  function renderFatal(message) {
    try {
      // Reveal native UI when showing fatal error
      showNativeUI();
      
      const existing = document.getElementById('rbs-room-finder-host');
      if (existing) existing.remove();
      
      const hostEl = el('div', { id: 'rbs-room-finder-host' });
      document.body.appendChild(hostEl);
      const shadow = hostEl.attachShadow({ mode: 'open' });
      shadow.appendChild(el('style', { text: PANEL_CSS }));
      
      const host = el('div', { class: 'rbs-fullpage' });
      shadow.appendChild(host);
      
      const errorDiv = el('div', { 
        style: 'display: flex; align-items: center; justify-content: center; height: 100%; color: #ff6b6b; font-size: 14px; padding: 20px; text-align: center;'
      }, message);
      host.appendChild(errorDiv);
      
      console.error('RBS Room Finder fatal:', message);
    } catch (e) {
      console.error('RBS Room Finder fatal (rendering failed):', message, e);
    }
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
    const boardScroll = el('div', { class: 'rbs-board-scroll' });
    const boardHeader = el('div', { class: 'rbs-board-header' });
    const boardRows = el('div', { class: 'rbs-board-rows' });
    
    boardScroll.appendChild(boardHeader);
    boardScroll.appendChild(boardRows);
    boardArea.appendChild(boardScroll);
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
      // Default to TOMORROW, not today: the current day legitimately returns no slots
      // for hours that have already passed, which reads as a half-empty board.
      const today = new Date();
      const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      const isTomorrow = d.getFullYear() === tomorrow.getFullYear() && d.getMonth() === tomorrow.getMonth() && d.getDate() === tomorrow.getDate();
      if (isTomorrow) chip.classList.add('rbs-selected');
      chips.push(chip);
    }
    return chips;
  }


  // Keep a requested time inside the drawn day window (07:00-22:30).
  function clampToDay(value, fallback) {
    const v = String(value == null ? '' : value).trim();
    if (!/^\d{1,2}:\d{2}$/.test(v)) return fallback;
    const [h, m] = v.split(':').map(Number);
    const mins = h * 60 + m;
    const lo = timeToMinutes(DAY_WINDOW.start);
    const hi = timeToMinutes(DAY_WINDOW.end);
    if (mins < lo) return DAY_WINDOW.start;
    if (mins > hi) return DAY_WINDOW.end;
    return v;
  }

  function buildTopBar(shellUI, roomTypes, windowOpts, attachListeners = true) {
    const useShoelace = hasShoelace();
    const topbar = el('div', { class: 'rbs-topbar' });
    
    // Brand
    const buildingName = readBuildingName() || 'RBS';
    const brand = el('div', { class: 'rbs-brand' }, [
      el('span', { class: 'rbs-brand-text', text: 'Room Finder' }),
      el('span', { class: 'rbs-brand-building', text: buildingName })
    ]);
    topbar.appendChild(brand);
    
    // Building select - use sl-select with hoist to avoid clipping
    const buildingSelect = useShoelace 
      ? createControl('sl-select', { 
          size: 'small', 
          hoist: true,
          label: 'Building',
          placeholder: 'All buildings'
        }, [
          createControl('sl-option', { value: '', text: 'All buildings' })
        ], 'select')
      : el('select', {}, [
          el('option', { value: '', text: 'Building…' })
        ]);
    
    topbar.appendChild(el('div', { class: 'rbs-control-group' }, [buildingSelect]));
    
    // Room type select - use sl-select with hoist
    const typeSelect = useShoelace
      ? createControl('sl-select', {
          size: 'small',
          hoist: true,
          label: 'Room type'
        }, [
          createControl('sl-option', { value: '', text: 'All rooms' }),
          ...roomTypes.map(t => createControl('sl-option', { value: t, text: t }))
        ], 'select')
      : (() => {
          const select = el('select');
          select.appendChild(el('option', { value: '', text: 'All rooms' }));
          for (const t of roomTypes) {
            select.appendChild(el('option', { value: t, text: t }));
          }
          return select;
        })();
    
    topbar.appendChild(el('div', { class: 'rbs-control-group' }, [typeSelect]));
    
    // Capacity input - use sl-input type="number"
    const capInput = useShoelace
      ? createControl('sl-input', {
          type: 'number',
          size: 'small',
          placeholder: 'Min capacity',
          'aria-label': 'Minimum capacity',
          value: ''
        }, null, 'input')
      : el('input', {
          class: 'rbs-capacity-input',
          type: 'number',
          min: '0',
          placeholder: 'Min capacity',
          'aria-label': 'Minimum capacity',
          value: ''
        });
    
    topbar.appendChild(el('div', { class: 'rbs-control-group' }, [capInput]));
    
    // Search input - use sl-input type="search" with clearable
    const searchInput = useShoelace
      ? createControl('sl-input', {
          type: 'search',
          size: 'small',
          placeholder: 'Search room code',
          clearable: true
        }, null, 'input')
      : el('input', {
          class: 'rbs-search-input',
          type: 'search',
          placeholder: 'Search rooms'
        });
    
    topbar.appendChild(el('div', { class: 'rbs-control-group' }, [searchInput]));
    
    // Date chips (keep as custom, not Shoelace)
    const dateChips = el('div', { class: 'rbs-date-chips' });
    buildDateChips(new Date(), 14).forEach(chip => dateChips.appendChild(chip));
    topbar.appendChild(dateChips);
    
    // Window controls - use sl-select
    const windowControls = el('div', { class: 'rbs-window-controls' });
    
    const startSelect = useShoelace
      ? createControl('sl-select', { size: 'small' }, 
          windowOpts.from.map(t => createControl('sl-option', { value: t, text: t })),
          'select')
      : (() => {
          const select = el('select', { class: 'rbs-window-select' });
          for (const t of windowOpts.from) select.appendChild(el('option', { value: t, text: t }));
          return select;
        })();
    
    const endSelect = useShoelace
      ? createControl('sl-select', { size: 'small' },
          windowOpts.to.map(t => createControl('sl-option', { value: t, text: t })),
          'select')
      : (() => {
          const select = el('select', { class: 'rbs-window-select' });
          for (const t of windowOpts.to) select.appendChild(el('option', { value: t, text: t }));
          return select;
        })();
    
    // Set default values
    if (windowOpts.from.includes(DEFAULT_WINDOW.start)) {
      if (useShoelace) startSelect.value = DEFAULT_WINDOW.start;
      else startSelect.value = DEFAULT_WINDOW.start;
    }
    if (windowOpts.to.includes(DEFAULT_WINDOW.end)) {
      if (useShoelace) endSelect.value = DEFAULT_WINDOW.end;
      else endSelect.value = DEFAULT_WINDOW.end;
    }
    
    windowControls.appendChild(startSelect);
    windowControls.appendChild(el('span', { text: '–' }));
    windowControls.appendChild(endSelect);
    windowControls.setAttribute('title', 'Time range for the board');
    windowControls.setAttribute('aria-label', 'Time range');
    topbar.appendChild(windowControls);
    
    // Sort select - use sl-select
    const sortSelect = useShoelace
      ? createControl('sl-select', { size: 'small', label: 'Sort', value: 'name' }, [
          createControl('sl-option', { value: 'name', text: 'Name' }),
          createControl('sl-option', { value: 'capacity', text: 'Capacity' })
        ], 'select')
      : (() => {
          const select = el('select', { class: 'rbs-window-select' });
          select.appendChild(el('option', { value: 'name', text: 'Name' }));
          select.appendChild(el('option', { value: 'capacity', text: 'Capacity' }));
          return select;
        })();
    
    topbar.appendChild(el('div', { class: 'rbs-control-group' }, [sortSelect]));
    
    // Legend
    const legend = el('div', { class: 'rbs-legend' }, [
      el('span', { class: 'rbs-legend-swatch rbs-free-swatch' }),
      el('span', { text: 'Free' }),
      el('span', { class: 'rbs-legend-swatch rbs-taken-swatch', style: 'margin-left: 10px' }),
      el('span', { text: 'Booked' }),
      el('span', { class: 'rbs-legend-swatch rbs-closed-swatch', style: 'margin-left: 10px' }),
      el('span', { text: 'Not open' })
    ]);
    topbar.appendChild(legend);
    
    // Action buttons - use sl-button
    const actions = el('div', { class: 'rbs-topbar-actions' });
    
    const refreshBtn = useShoelace
      ? createControl('sl-button', {
          size: 'small',
          variant: 'default',
          text: 'Refresh'
        }, null, 'button')
      : el('button', {
          class: 'rbs-action-btn',
          text: 'Refresh'
        });
    
    const nativeBtn = useShoelace
      ? createControl('sl-button', {
          size: 'small',
          variant: 'default',
          text: 'Native page'
        }, null, 'button')
      : el('button', {
          class: 'rbs-action-btn',
          text: 'Native page'
        });
    
    // Book on native form button (for drawer)
    const bookBtn = useShoelace
      ? createControl('sl-button', {
          size: 'small',
          variant: 'primary',
          text: 'Book on native form'
        }, null, 'button')
      : el('button', {
          class: 'rbs-action-btn rbs-primary',
          text: 'Book on native form'
        });
    
    // Clear button (for drawer)
    const clearBtn = useShoelace
      ? createControl('sl-button', {
          size: 'small',
          variant: 'text',
          text: 'Clear'
        }, null, 'button')
      : el('button', {
          class: 'rbs-action-btn',
          text: 'Clear'
        });
    
    // Only attach listeners if requested (safer for initialization)
    if (attachListeners) {
      if (useShoelace) {
        refreshBtn.addEventListener('click', onLoadBoard);
        nativeBtn.addEventListener('click', () => {
          if (document.documentElement.classList.contains('rbsx-native-hidden')) {
            showNativeUI();
            nativeBtn.textContent = 'Show App';
          } else {
            hideNativeUI();
            nativeBtn.textContent = 'Native UI';
          }
        });
      } else {
        refreshBtn.addEventListener('click', onLoadBoard);
        nativeBtn.addEventListener('click', () => {
          if (document.documentElement.classList.contains('rbsx-native-hidden')) {
            showNativeUI();
            nativeBtn.textContent = 'Show App';
          } else {
            hideNativeUI();
            nativeBtn.textContent = 'Native UI';
          }
        });
      }
    }
    
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
      bookBtn,
      clearBtn,
      useShoelace
    };
  }
  
  function attachEventListeners(uiRefs) {
    if (!uiRefs) return;
    
    // Refresh button
    uiRefs.refreshBtn.addEventListener('click', () => requestReload('refresh'));
    
    // Native UI toggle button
    uiRefs.nativeBtn.addEventListener('click', () => {
      if (document.documentElement.classList.contains('rbsx-native-hidden')) {
        showNativeUI();
        uiRefs.nativeBtn.textContent = 'Show App';
      } else {
        hideNativeUI();
        uiRefs.nativeBtn.textContent = 'Native UI';
      }
    });
    
    // Date chips selection - write date to form and reload
    uiRefs.dateChips.querySelectorAll('.rbs-date-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        uiRefs.dateChips.querySelectorAll('.rbs-date-chip').forEach(c => 
          c.classList.remove('rbs-selected')
        );
        chip.classList.add('rbs-selected');
        requestReload('date');
      });
    });
    
    // Building select - immediate reload when changed
    const buildingEvent = uiRefs.useShoelace ? 'sl-change' : 'change';
    uiRefs.buildingSelect.addEventListener(buildingEvent, () => {
      // Update room types and window options based on new building
      updateTypeAndWindowSelects(uiRefs.typeSelect, uiRefs.startSelect, uiRefs.endSelect);
      requestReload('building');
    });
    
    // Room type select - immediate reload
    const typeEvent = uiRefs.useShoelace ? 'sl-change' : 'change';
    uiRefs.typeSelect.addEventListener(typeEvent, () => requestReload('type'));
    
    // Window start select - immediate reload
    const startEvent = uiRefs.useShoelace ? 'sl-change' : 'change';
    uiRefs.startSelect.addEventListener(startEvent, () => requestReload('window-start'));
    
    // Window end select - immediate reload
    const endEvent = uiRefs.useShoelace ? 'sl-change' : 'change';
    uiRefs.endSelect.addEventListener(endEvent, () => requestReload('window-end'));
    
    // Sort select - immediate reload
    const sortEvent = uiRefs.useShoelace ? 'sl-change' : 'change';
    uiRefs.sortSelect.addEventListener(sortEvent, () => requestReload('sort'));
    
    // Capacity input - debounced reload
    const debouncedCapacityReload = debounce(() => requestReload('capacity'), 300);
    const capacityEvent = uiRefs.useShoelace ? 'sl-input' : 'input';
    uiRefs.capInput.addEventListener(capacityEvent, debouncedCapacityReload);
    
    // Search input - debounced reload
    const debouncedSearchReload = debounce(() => requestReload('search'), 300);
    const searchEvent = uiRefs.useShoelace ? 'sl-input' : 'input';
    uiRefs.searchInput.addEventListener(searchEvent, debouncedSearchReload);
  }

  // ---- board ----------------------------------------------------------------


  // Grid template for the board: a fixed room column plus one track per axis slot.
  function roomColumnTemplate(axis) {
    const n = Array.isArray(axis) ? axis.length : 0;
    return `200px repeat(${n}, minmax(0, 1fr))`;
  }

  function buildHourAxis(axis) {
    const header = getUI().boardHeader;
    header.innerHTML = '';
    // The board grid is `roomColumn` + one track per axis slot; the room column is a
    // separate element outside that grid, so the header must lead with its own
    // "Room" cell and then place one cell per slot: 1 + axis.length cells.
    header.style.gridTemplateColumns = roomColumnTemplate(axis);
    header.appendChild(el('div', { class: 'rbs-room-label', text: 'Room' }));
    const cellInfo = buildAxisHeaderCells(axis);
    for (let i = 0; i < cellInfo.length; i++) {
      const { isHour, label } = cellInfo[i];
      const isLast = i === cellInfo.length - 1;
      header.appendChild(el('div', {
        class: 'rbs-room-label' + (isHour ? ' rbs-hour' : '') + (isLast ? ' rbs-hour-last' : ''),
        text: isHour || isLast ? label : '\u00b7',
        title: label
      }));
    }
  }

  function buildRoomRow(room) {
    const row = el('div', {
      class: 'rbs-board-row' + ((board.rowIndex++ % 2) ? ' rbs-row-odd' : ''),
      'data-rsrcid': room.id
    });
    
    // Set grid columns to match header
    row.style.gridTemplateColumns = roomColumnTemplate(board.axis);
    
    // Room info column
    const roomInfo = el('div', { class: 'rbs-room-info' }, [
      el('span', { class: 'rbs-room-code', text: room.name }),
      // Redundant while a specific room type is selected - that space belongs to the code.
      (board.form && board.form.roomType) ? null : el('span', { class: 'rbs-room-type', text: room.type || '', title: room.type || '' }),
      el('span', { class: 'rbs-room-cap', text: String(room.capacity), title: 'Capacity ' + room.capacity })
    ]);
    row.appendChild(roomInfo);
    
    // Slot cells (skeleton state)
    for (let i = 0; i < board.axis.length; i++) {
      const cell = el('div', { class: 'rbs-slot-cell rbs-skel' });
      // Add hour boundary class for cells before hour marks (odd indices)
      if (i % 2 === 1) {
        cell.classList.add('rbs-hour-boundary');
      }
      cell.addEventListener('click', (e) => onCellClick(room.id, i, e));
      row.appendChild(cell);
    }
    
    return row;
  }

  function renderBoardSkeleton(rooms) {
    board.rowIndex = 0;
    const currentUI = getUI();
    currentUI.boardRows.innerHTML = '';
    
    // Build hour axis based on current window
    const start = currentUI.startSelect.value || DEFAULT_WINDOW.start;
    const end = currentUI.endSelect.value || DEFAULT_WINDOW.end;
    board.axis = buildSlotAxis(start, end);
    buildHourAxis(board.axis);
    
    // Build room rows
    for (const room of rooms) {
      const row = buildRoomRow(room);
      currentUI.boardRows.appendChild(row);
      board.blocks.set(room.id, {
        rowEl: row,
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
    blocks: new Map(), // roomId -> { rowEl, cellsEl, cells, loaded, failed }
    observer: null, // IntersectionObserver for viewport prioritisation
    generation: 0,
    rowIndex: 0,
    loadedCount: 0,
    totalCount: 0,
    failedCount: 0,
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
      // A 200 with an HTML body means RBS answered with a page, not data — the
      // usual cause is an expired SIT session silently redirecting to /Home/ErrorPage.
      const looksLikeHtml = /^\s*<(!doctype|html)/i.test(text);
      throw ApiError(
        looksLikeHtml
          ? 'RBS returned a web page instead of data — your SIT session has probably expired. Reload the page and sign in again.'
          : 'the RBS API returned an error (unparseable JSON)',
        resp.status
      );
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
      // 'between' with empty capacities returns every room; the native select can sit
      // on '<' or '>' from earlier page state, which makes the server return nothing.
      capacityOperator: 'between',
      campusID: readIdValue(RBS_CONTROL_IDS.campus),
      buildingID: readIdValue(RBS_CONTROL_IDS.building),
      // Must be literal 'facilities': an empty faciequip makes the endpoint return [].
      facilities: 'facilities',
      status: 'All',
      // The endpoint expects the option TEXT with spaces ("Discussion Room"); our
      // sl-option values use underscores ("Discussion_Room") for DOM safety.
      resourceType: form.roomType ? String(form.roomType).replace(/_/g, ' ') : '',
      date: form.date,
      // Always search the whole day at this stage: the server only returns rooms that
      // have slots inside the requested window, which silently drops rooms when the
      // native start/end pins are narrow.
      start: DAY_WINDOW.start,
      end: DAY_WINDOW.end,
    });
    const json = await postForm(RBS_ENDPOINTS.searchList, fields);
    return parseRooms(json);
  }

  // Fetch one room's slots. Returns parseSlots() output.
  async function fetchSlots(room, form) {
    // Pinned to the full day so the board always shows 07:00-22:30 and the chosen
    // window only dims cells (see paintBlock) instead of truncating the axis.
    const fields = buildSlotPayload(room, form.date, DAY_WINDOW, 'All', readToken());
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
      // Add hour boundary class for cells before hour marks (odd indices)
      if (i % 2 === 1) {
        cell.classList.add('rbs-hour-boundary');
      }
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
        cell.title = `${label} — booked`;
      } else if (slot.state === 'closed') {
        cell.classList.add('rbs-closed');
        cell.title = `${label} — not open for booking`;
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
    
    // Mark as failed
    entry.failed = true;
    
    // Update error text in status bar
    if (!ui) return;
    const errorEl = ui.errorIndicator?.querySelector('#rbs-error-text');
    if (errorEl) {
      errorEl.textContent = `Failed to load some rooms`;
      ui.errorIndicator.style.display = 'flex';
    }
  }

  // Count a room as reaching a terminal state (loaded or failed) exactly once.
  function accountRoom(roomId) {
    const entry = board.blocks.get(roomId);
    if (!entry || entry.accounted) return;
    entry.accounted = true;
    
    if (entry.failed) {
      board.failedCount += 1;
    } else {
      board.loadedCount += 1;
    }
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
      { root: getUI().boardScroll, threshold: 0.1 }
    );
    for (const entry of board.blocks.values()) {
      board.observer.observe(entry.rowEl);
    }
  }

  function updateProgress() {
    if (!ui) return;
    const statsEl = ui.stats?.querySelector('#rbs-stats-text');
    if (statsEl) {
      const inFlight = board.queue?.inFlight || 0;
      let statusText = queueStatus({
        loaded: board.loadedCount,
        total: board.totalCount,
        inFlight: inFlight,
        failed: board.failedCount
      });
      
      // Add warning for "All rooms" selection
      if (board.form && board.form.roomType === '' && board.totalCount >= 60) {
        statusText += ` (All rooms — ${board.totalCount} rooms, ~2.2 s each)`;
      }
      
      statsEl.textContent = statusText;
    }
  }

  function finalizeStatus() {
    if (board.observer) { board.observer.disconnect(); board.observer = null; }
    
    if (!ui) return;
    const statsEl = ui.stats?.querySelector('#rbs-stats-text');
    if (statsEl) {
      statsEl.textContent = queueStatus({
        loaded: board.loadedCount,
        total: board.totalCount,
        inFlight: 0,
        failed: board.failedCount
      });
    }
    
    // Clear any error text on successful completion
    const errorEl = ui.errorIndicator?.querySelector('#rbs-error-text');
    if (errorEl) {
      errorEl.textContent = '';
      ui.errorIndicator.style.display = 'none';
    }
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
      getUI().main.appendChild(drawer.drawerEl);
    }
    
    const window = rangeToWindow(board.axis, range.startIdx, range.endIdx);
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
      el('div', { class: 'rbs-slot-count', text: `${window.count} slot(s)` })
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

  function buildStatusBar(hostElement) {
    const statusbar = el('div', { class: 'rbs-statusbar' });
    const stats = el('div', { class: 'rbs-stats' });
    const errorIndicator = el('div', { class: 'rbs-error-indicator' });
    errorIndicator.style.display = 'none';
    
    stats.appendChild(el('span', { id: 'rbs-stats-text', text: '0/0 rooms loaded · 0 requests in flight' }));
    errorIndicator.appendChild(el('span', { id: 'rbs-error-text' }));
    errorIndicator.appendChild(el('button', { class: 'rbs-retry-btn', text: 'retry' }));
    
    statusbar.appendChild(stats);
    statusbar.appendChild(errorIndicator);
    
    if (hostElement) {
      hostElement.appendChild(statusbar);
    }
    
    return { statusBar: statusbar, stats, errorIndicator };
  }

  // ---- hide/toggle native UI ------------------------------------------------

  function hideNativeUI() {
    try {
      // Add class to document element first
      document.documentElement.classList.add('rbsx-native-hidden');
      
      // Remove app hidden class to show the app
      if (ui && ui.host) {
        ui.host.classList.remove('rbs-app-hidden');
      }
      
      // Inject stylesheet to hide native UI elements
      const styleId = 'rbs-native-hide';
      let style = document.getElementById(styleId);
      if (!style) {
        style = el('style', { id: styleId });
        style.textContent = NATIVE_HIDE_SELECTORS.map(sel => `${sel} { display: none !important; }`).join('\n');
        document.head.appendChild(style);
      }
    } catch (err) {
      console.warn('Failed to hide native UI:', err);
    }
  }

  function showNativeUI() {
    const style = document.getElementById('rbs-native-hide');
    if (style) style.remove();
    document.documentElement.classList.remove('rbsx-native-hidden');
    
    // Add app hidden class to hide the app
    if (ui && ui.host) {
      ui.host.classList.add('rbs-app-hidden');
    }
  }

  // ---- keyboard shortcuts ---------------------------------------------------

  function keyToAction(event) {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT' || event.target.tagName === 'TEXTAREA') {
      return null;
    }
    
    switch (event.key) {
      case '/':
        event.preventDefault();
        getUI().searchInput?.focus();
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
    const currentUI = getUI();
    
    if (form.roomType != null &&
        (form.roomType === '' || roomTypes.includes(form.roomType))) {
      currentUI.typeSelect.value = form.roomType;
    }
    if (form.date) {
      // Select date chip
      const chip = currentUI.dateChips.querySelector(`[data-date="${form.date}"]`);
      if (chip) {
        currentUI.dateChips.querySelectorAll('.rbs-date-chip').forEach(c => c.classList.remove('rbs-selected'));
        chip.classList.add('rbs-selected');
      }
    }
    if (form.window) {
      if (form.window.start && windowOpts.from.includes(form.window.start)) currentUI.startSelect.value = form.window.start;
      if (form.window.end && windowOpts.to.includes(form.window.end)) currentUI.endSelect.value = form.window.end;
    }
    if (form.minCapacity != null) currentUI.capInput.value = String(form.minCapacity);
    if (form.sort) currentUI.sortSelect.value = form.sort;
  }

  // ---- reload coordination -------------------------------------------------

  let reloadInProgress = false;
  let queuedReload = false;

  function requestReload(reason) {
    console.log('requestReload:', reason);
    
    // If a reload is already in progress, queue another one
    if (reloadInProgress) {
      queuedReload = true;
      return;
    }
    
    // Start reload
    reloadInProgress = true;
    
    // Disable controls during reload
    disableControls(true);
    
    // Show loading status
    updateStatusBarLoading();
    
    // Execute the load
    onLoadBoard().finally(() => {
      reloadInProgress = false;
      disableControls(false);
      
      // If another reload was queued while we were loading, run it now
      if (queuedReload) {
        queuedReload = false;
        setTimeout(() => requestReload('queued'), 50);
      }
    });
  }

  function disableControls(disabled) {
    if (!ui) return;
    
    const controls = [
      ui.buildingSelect,
      ui.typeSelect,
      ui.capInput,
      ui.searchInput,
      ui.startSelect,
      ui.endSelect,
      ui.sortSelect,
      ui.refreshBtn
    ];
    
    controls.forEach(control => {
      if (control) control.disabled = disabled;
    });
    
    // Also disable date chips
    if (ui.dateChips) {
      ui.dateChips.querySelectorAll('.rbs-date-chip').forEach(chip => {
        chip.style.pointerEvents = disabled ? 'none' : '';
        chip.style.opacity = disabled ? '0.5' : '';
      });
    }
  }

  function updateStatusBarLoading() {
    if (!ui || !ui.stats) return;
    
    const statsEl = ui.stats.querySelector('#rbs-stats-text');
    if (statsEl) {
      statsEl.textContent = 'Loading…';
    }
    
    // Clear any previous error
    const errorEl = ui.errorIndicator?.querySelector('#rbs-error-text');
    if (errorEl) {
      errorEl.textContent = '';
      ui.errorIndicator.style.display = 'none';
    }
  }

  function showError(message) {
    if (!ui || !ui.errorIndicator) return;
    
    const errorEl = ui.errorIndicator.querySelector('#rbs-error-text');
    if (errorEl) {
      errorEl.textContent = message;
      ui.errorIndicator.style.display = 'flex';
    }
    
    // Update stats to show error
    const statsEl = ui.stats?.querySelector('#rbs-stats-text');
    if (statsEl) {
      statsEl.textContent = 'Error';
    }
  }

  function showEmptyState(message) {
    if (!ui) return;
    
    // Clear the board
    if (ui.boardRows) {
      ui.boardRows.innerHTML = '';
    }
    
    // Show message in stats
    const statsEl = ui.stats?.querySelector('#rbs-stats-text');
    if (statsEl) {
      statsEl.textContent = message;
    }
    
    // Clear any error
    const errorEl = ui.errorIndicator?.querySelector('#rbs-error-text');
    if (errorEl) {
      errorEl.textContent = '';
      ui.errorIndicator.style.display = 'none';
    }
    
    // Update board state
    board.blocks = new Map();
    board.loadedCount = 0;
    board.totalCount = 0;
    board.failedCount = 0;
  }

  // ---- main Load board flow ------------------------------------------------

  async function onLoadBoard() {
    // Guard against null ui
    if (!ui) {
      renderFatal('Panel not initialized');
      return;
    }
    
    // Read form from UI
    const currentUI = getUI();
    const form = {
      roomType: currentUI.typeSelect.value,
      date: currentUI.dateChips.querySelector('.rbs-date-chip.rbs-selected')?.dataset.date || formatDate(new Date()),
      // Narrow windows are clamped into the day window: asking the server for a
      // window it no longer offers (e.g. an inherited 12:00 pin) returns slots that
      // start late and then align to nothing.
      // The board is pinned to the drawn day window; the user's window only dims
      // cells (see paintBlock). Never narrow the request itself.
      window: { start: DAY_WINDOW.start, end: DAY_WINDOW.end },
      minCapacity: Number(currentUI.capInput.value) || 0,
      sort: currentUI.sortSelect.value,
    };

    // Validate the window.
    const sMin = timeToMinutes(form.window.start);
    const eMin = timeToMinutes(form.window.end);
    if (isNaN(sMin) || isNaN(eMin) || eMin <= sMin) {
      showError('Invalid time window');
      return;
    }

    // A new load bumps the generation: any in-flight queue is abandoned.
    board.generation += 1;
    if (board.queue) board.queue.bumpGeneration();

    board.form = form;
    board.blocks = new Map();
    board.loadedCount = 0;
    board.totalCount = 0;
    board.failedCount = 0;
    if (board.observer) { board.observer.disconnect(); board.observer = null; }
    
    // Reset status bar
    updateProgress();

    let rooms;
    try {
      rooms = await fetchRooms(form);
    } catch (e) {
      showError(`Failed to load rooms: ${e.message}`);
      return;
    }

    const roomsFromSearch = rooms.length;
    
    // Filter equipment out of "All rooms"
    const roomTypesList = readRoomTypes(); // Read fresh each time
    const filtered = filterRooms(rooms, form.roomType, form.minCapacity, roomTypesList);
    
    const ordered = sortRooms(filtered, form.sort);
    
    if (ordered.length === 0) {
      showEmptyState('No rooms match these filters — widen the room type or clear the min capacity.');
      return;
    }

    // Render skeleton
    renderBoardSkeleton(ordered);

    // Build the single-flight queue
    const myGen = board.generation;
    board.queue = createSlotQueue({
      fetcher: (room) => fetchSlots(room, form),
      date: form.date,
      // Must match what fetchSlots actually requests (DAY_WINDOW), or the cache key
      // is built from the user's window and every narrowed window refetches/ghosts.
      window: DAY_WINDOW,
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
      onDone: () => {
        if (board.generation !== myGen) return;
        const freeCells = ui.boardRows ? ui.boardRows.querySelectorAll('.rbs-free').length : 0;
        const total = ui.boardRows ? ui.boardRows.querySelectorAll('.rbs-slot-cell').length : 0;
        if (total > 0 && freeCells === 0) {
          const statsEl = ui.stats && ui.stats.querySelector('#rbs-stats-text');
          if (statsEl) {
            statsEl.textContent = 'No bookable slots on this date — every slot is closed. Try the next day.';
          }
        }
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
    // Single-init guard
    if (window.__rbsPanelInitialized) return;
    window.__rbsPanelInitialized = true;
    
    let localUI = null;
    try {
      const missing = missingControlIds();
      const hostEl = el('div', { id: 'rbs-room-finder-host' });
      document.body.appendChild(hostEl);
      const shadow = hostEl.attachShadow({ mode: 'open' });
      
      const shellUI = buildFullPageShell(shadow, missing);
      if (!shellUI) {
        renderFatal('Failed to build full page shell');
        return;
      }
      
      // Build top bar (Pass 2) - but DON'T attach listeners yet
      const roomTypes = readRoomTypes();
      const windowOpts = readWindowOptions();
      const topBar = buildTopBar(shellUI, roomTypes, windowOpts, false); // false = no listeners
      
      // Build status bar (Pass 5)
      const statusBar = buildStatusBar(shellUI.host);
      
      // Combine UI references into local object first
      localUI = { ...shellUI, ...topBar, ...statusBar };
      
      // Run self-check before assigning to global ui
      const check = selfCheck(localUI);
      if (shouldRevealNativeOnFailure(check)) {
        // Show native UI and render error
        showNativeUI();
        renderFatal('UI self-check failed: ' + check.missing.join(', '));
        return;
      }
      
      // Now attach event listeners safely
      attachEventListeners(localUI);
      
      // Only now assign to global ui
      ui = localUI;
      
      // Hide native UI only AFTER self-check passes and UI is assigned
      hideNativeUI();
      
      // Populate building select asynchronously, which will also update room types and window options
      populateBuildingSelect(ui.buildingSelect, ui.typeSelect, ui.startSelect, ui.endSelect).then(() => {
        // After building select is populated and room types/window options are updated,
        // Apply default form (first concrete room type + native building)
        const nativeState = {
          // readRoomTypes() also returns the native placeholder ("Resource Type");
          // feeding that to defaultForm picks it as the first concrete type.
          roomTypes: (function () {
            const fromSelect = readControlOptions(ui.typeSelect)
              .map(o => (o.textContent || '').trim())
              .filter(t => t && !/^Resource Type$/i.test(t));
            return fromSelect.length ? fromSelect : readRoomTypes();
          })(),
          building: readIdValue(RBS_CONTROL_IDS.building),
          buildingName: readBuildingName()
        };
        const defaultFormValues = defaultForm(nativeState);
        // Shoelace option values are DOM-safe (spaced values become underscores), so
        // the option's value may be "Discussion_Room" where the default says
        // "Discussion Room". Resolve by option text, then by normalised value.
        const resolveValue = (control, wanted) => {
          if (!control || !wanted) return null;
          const norm = (v) => String(v).toLowerCase().replace(/[^a-z0-9]/g, '');
          const opts = readControlOptions(control);
          const byValue = opts.find(o => (o.value || o.getAttribute('value') || '') === wanted);
          if (byValue) return byValue.value || byValue.getAttribute('value');
          const byText = opts.find(o => (o.textContent || '').trim() === wanted);
          if (byText) return byText.value || byText.getAttribute('value');
          const byNorm = opts.find(o => norm(o.value || o.getAttribute('value') || '') === norm(wanted) || norm(o.textContent || '') === norm(wanted));
          return byNorm ? (byNorm.value || byNorm.getAttribute('value')) : null;
        };
        const wantedType = resolveValue(ui.typeSelect, defaultFormValues.roomType);
        if (wantedType) ui.typeSelect.value = wantedType;
        const wantedBuilding = resolveValue(ui.buildingSelect, defaultFormValues.building);
        if (wantedBuilding && !ui.buildingSelect.disabled) ui.buildingSelect.value = wantedBuilding;
        
        // Override room type with first concrete type
        if (defaultFormValues.roomType && ui.typeSelect) {
          // Check if this room type exists in the select
          const roomTypeExists = readControlOptions(ui.typeSelect)
            .some(opt => (opt.value || opt.getAttribute('value') || '') === defaultFormValues.roomType);
          
          if (roomTypeExists) {
            ui.typeSelect.value = defaultFormValues.roomType;
          }
        }
        
        // Set building if available
        if (defaultFormValues.building && ui.buildingSelect && !ui.buildingSelect.disabled) {
          // Check if building exists in select
          const buildingExists = readControlOptions(ui.buildingSelect)
            .some(opt => (opt.value || opt.getAttribute('value') || '') === defaultFormValues.building);
          
          if (buildingExists) {
            ui.buildingSelect.value = defaultFormValues.building;
          }
        }
        
        // Trigger initial load if all required fields are available
        if (ui.buildingSelect.disabled === false) {
          // Check if we have valid form values
          const hasBuilding = ui.buildingSelect.value !== '';
          const hasDate = ui.dateChips.querySelector('.rbs-date-chip.rbs-selected') !== null;
          const hasStart = ui.startSelect.value && ui.startSelect.options.length > 0;
          const hasEnd = ui.endSelect.value && ui.endSelect.options.length > 0;
          
          if (hasBuilding || hasDate || (hasStart && hasEnd)) {
            // Wait for a concrete room type to land before the first search: reading
            // #resourceType too early yields only the placeholder, and an empty type
            // means "All rooms" = ~60 rooms at ~2.2 s per serialised slot call.
            const startInitialLoad = (attempt) => {
              let currentType = ui.typeSelect.value;
              if (!currentType) {
                // Selects used to be built with spaced values ("Discussion Room");
                // they now carry underscored ones ("Discussion_Room"). Pick the first
                // concrete type ourselves rather than trusting ui.typeSelect.value.
                const concrete = readControlOptions(ui.typeSelect)
                  .find(o => {
                    const v = o.value || o.getAttribute('value') || '';
                    return v && !/^Resource_?Type$/i.test(v);
                  });
                if (concrete) {
                  ui.typeSelect.value = concrete.value || concrete.getAttribute('value');
                  currentType = ui.typeSelect.value;
                }
              }
              if (!currentType && attempt < 6) {
                setTimeout(() => startInitialLoad(attempt + 1), 500);
                return;
              }
              if (!currentType) {
                // Still nothing usable after ~3 s: fall back to the loaded state we have.
                ui.typeSelect.value = '';
              }
              requestReload('initial');
            };
            setTimeout(() => startInitialLoad(0), 100);
          }
        }
      }).catch(err => {
        console.warn('Failed to populate building select:', err);
      });
      
      // Add keyboard listeners
      document.addEventListener('keydown', (e) => {
        const action = keyToAction(e);
        if (action) {
          e.preventDefault();
          e.stopPropagation();
        }
      });
      
      // Restore last search (but don't auto-run) - but override with defaults
      const last = await loadLast();
      if (last) applyForm(last, roomTypes, windowOpts);
      
      return ui;
    } catch (error) {
      // Show native UI on any init failure
      showNativeUI();
      renderFatal(`Init failed: ${error.message}`);
      return null;
    }
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

  // ---- nova bridge ----------------------------------------------------------
  //
  // ONE narrow, namespaced seam so the Nova (React/shadcn) skin can drive this
  // panel's real search engine without reaching into its private closure or
  // touching content/native.js. Everything here is additive: the old panel
  // keeps working exactly as before whether or not Nova ever calls the bridge.
  //
  //   window.__rbsBridge.readState()          -> live native page state
  //   window.__rbsBridge.applyForm(form)      -> push a form into the engine
  //   window.__rbsBridge.requestReload(reason)-> run the engine (single-flight)
  //   window.__rbsBridge.subscribe(fn)         -> notified on native changes
  //
  // The bridge is installed on every page load (below), BEFORE nova.bundle.js
  // mounts, so the skin can rely on it existing the moment it renders.

  const BRIDGE_EVENT = 'rbs:native-change';
  const bridgeListeners = new Set();

  // Resolve a wanted room-type (option TEXT like "Discussion Room", a value
  // like "Discussion_Room", or '') against a panel select's options. Returns
  // the option's own value so panel's fetchRooms (which maps _ -> space) is fed
  // exactly what it expects. '' always maps to "All rooms".
  function resolveTypeValue(control, wanted) {
    if (!control) return '';
    if (wanted === '' || wanted == null) return '';
    const norm = (v) => String(v).toLowerCase().replace(/[^a-z0-9]/g, '');
    const opts = readControlOptions(control);
    const val = (o) => o.value || o.getAttribute('value') || '';
    const byValue = opts.find((o) => val(o) === wanted);
    if (byValue) return val(byValue);
    const byText = opts.find((o) => (o.textContent || '').trim() === wanted);
    if (byText) return val(byText);
    const byNorm = opts.find((o) => norm(val(o)) === norm(wanted) || norm(o.textContent || '') === norm(wanted));
    return byNorm ? val(byNorm) : '';
  }

  // Read the live native page state the skin needs to render reactively. Pure
  // reads of the native DOM — never mutates anything.
  function bridgeReadState() {
    const buildingSel = document.getElementById(RBS_CONTROL_IDS.building);
    const buildings = buildingSel
      ? Array.from(buildingSel.options)
          .map((o) => ({ value: o.value || '', text: (o.textContent || '').trim() }))
          .filter((o) => o.text && !/^-+$/.test(o.text) && !/please select/i.test(o.text))
      : [];
    return {
      roomTypes: readRoomTypes(),
      windowOptions: readWindowOptions(),
      buildings,
      building: readIdValue(RBS_CONTROL_IDS.building),
      buildingName: readBuildingName(),
      date: (ui && ui.dateChips &&
        ui.dateChips.querySelector('.rbs-date-chip.rbs-selected')?.dataset.date) || formatDate(new Date()),
    };
  }

  // Notify every bridge subscriber (the skin) that native state moved.
  function notifyBridge(reason) {
    const state = bridgeReadState();
    for (const fn of bridgeListeners) {
      try { fn({ reason, state }); } catch (e) { /* subscriber error is non-fatal */ }
    }
    try {
      window.dispatchEvent(new CustomEvent(BRIDGE_EVENT, { detail: { reason, state } }));
    } catch (e) { /* CustomEvent unsupported: listeners still ran */ }
  }

  // Push a Nova form into the panel engine's own controls so onLoadBoard reads
  // exactly these values. Building changes drive the native cascade so room
  // types / window options repopulate just like the native select would.
  function bridgeApplyForm(form) {
    if (!ui || !form) return;

    // Building: set the panel's own select AND the native select, then fire the
    // native change so RBS repopulates #resourceType / #SearchHoursFrom/To.
    if (form.building != null) {
      const nativeBuilding = document.getElementById(RBS_CONTROL_IDS.building);
      if (nativeBuilding && nativeBuilding.value !== form.building) {
        const exists = Array.from(nativeBuilding.options).some((o) => o.value === form.building);
        if (exists || form.building === '') {
          nativeBuilding.value = form.building;
          nativeBuilding.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      if (ui.buildingSelect && !ui.buildingSelect.disabled) {
        const bOpts = readControlOptions(ui.buildingSelect).map((o) => o.value || o.getAttribute('value') || '');
        if (bOpts.includes(form.building)) ui.buildingSelect.value = form.building;
      }
      // Rebuild the dependent panel selects from the refreshed native cascade.
      updateTypeAndWindowSelects(ui.typeSelect, ui.startSelect, ui.endSelect);
    }

    // Room type: resolve against the panel select's own options.
    if (form.roomType != null && ui.typeSelect) {
      ui.typeSelect.value = resolveTypeValue(ui.typeSelect, form.roomType);
    }

    // Capacity.
    if (form.minCapacity != null && ui.capInput) {
      ui.capInput.value = String(form.minCapacity);
    }

    // Free-text search.
    if (form.search != null && ui.searchInput) {
      ui.searchInput.value = String(form.search);
    }

    // Date: select the matching chip (panel reads the selected chip's data-date).
    if (form.date && ui.dateChips) {
      const chip = ui.dateChips.querySelector(`[data-date="${form.date}"]`);
      if (chip) {
        ui.dateChips.querySelectorAll('.rbs-date-chip').forEach((c) => c.classList.remove('rbs-selected'));
        chip.classList.add('rbs-selected');
      }
    }

    // Window start/end (dims cells; the request stays pinned to DAY_WINDOW).
    if (form.window && ui.startSelect && ui.endSelect) {
      const wo = readWindowOptions();
      if (form.window.start && wo.from.includes(form.window.start)) ui.startSelect.value = form.window.start;
      if (form.window.end && wo.to.includes(form.window.end)) ui.endSelect.value = form.window.end;
    }

    // Sort.
    if (form.sort && ui.sortSelect) {
      ui.sortSelect.value = form.sort;
    }
  }

  // Wire native control changes through to bridge subscribers so the skin can
  // mirror live page state instead of a one-time mount snapshot.
  function wireNativeChangeBridge() {
    const ids = [
      RBS_CONTROL_IDS.campus,
      RBS_CONTROL_IDS.building,
      RBS_CONTROL_IDS.resourceType,
      RBS_CONTROL_IDS.start,
      RBS_CONTROL_IDS.end,
    ];
    for (const id of ids) {
      const node = document.getElementById(id);
      if (node) {
        node.addEventListener('change', () => notifyBridge(id));
      }
    }
  }

  function installBridge() {
    if (window.__rbsBridge) return; // never clobber an existing bridge
    window.__rbsBridge = Object.freeze({
      version: 1,
      readState: bridgeReadState,
      applyForm: bridgeApplyForm,
      requestReload: (reason) => requestReload(reason || 'nova'),
      subscribe: (fn) => {
        if (typeof fn !== 'function') return () => {};
        bridgeListeners.add(fn);
        return () => bridgeListeners.delete(fn);
      },
      eventName: BRIDGE_EVENT,
    });
  }

  // Full-site takeover: Nova is now the DEFAULT skin on EVERY path of the RBS
  // origin, not just the search page. This mirrors the exact decision in
  // src/main.tsx (novaDefaultOn): Nova owns the whole origin unless the
  // `?nova=0` escape hatch is present. When Nova owns the page, the old panel
  // (board OR launcher) stands down entirely so the two UIs never race, never
  // double-fetch, and the launcher never appears on top of the Nova shell. The
  // old path only runs under `?nova=0` (board on the search page, launcher
  // elsewhere), reaching the untouched native page.
  function novaDefaultOn() {
    try {
      if (/(?:^|[?&])nova=0(?:&|$)/.test(location.search)) return false; // escape hatch
      return true; // own every path on the origin
    } catch (e) {
      return false;
    }
  }

  function init() {
    if (!document.body) {
      window.addEventListener('DOMContentLoaded', init, { once: true });
      return;
    }
    // Install the bridge on every load, before Nova mounts, so the skin always
    // finds it. It reads ui/board lazily, so it is safe to install before init.
    installBridge();
    publishProbe();
    if (document.getElementById('rbs-room-finder-host') ||
        document.getElementById('rbs-room-finder-launcher-host')) {
      return;
    }
    // Nova owns every page by default. Do NOT build the old board or the
    // launcher (either would double up on the Nova shell / double-fetch). Only
    // the `?nova=0` escape hatch falls through to the old panel UI.
    if (novaDefaultOn()) return;
    if (isSearchPage()) {
      initSearchPage();
      wireNativeChangeBridge();
    } else {
      initLauncher();
    }
  }

  init();
})();