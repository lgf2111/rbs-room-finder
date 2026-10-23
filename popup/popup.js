/*
 * popup/popup.js
 *
 * The toolbar popup. It reports whether the current tab is RBS and whether the
 * expected native controls were found, lets the user pick a default room type,
 * opens RBS, and clears saved preferences.
 *
 * No network calls of its own, no eval, no remote code, no "scripting"
 * permission. The content script publishes a snapshot of the current page to
 * chrome.storage.local under "rbsProbe"; the popup just reads it. Storage is
 * the only permission this extension declares.
 */

'use strict';

(function () {
  const SEARCH_URL = 'https://rbs.singaporetech.edu.sg/SRB001/SRB001Page';
  const RBS_ORIGIN = 'https://rbs.singaporetech.edu.sg';

  // Storage keys — must match content/panel.js.
  const PROBE_KEY = 'rbsProbe';
  const LAST_SEARCH_KEY = 'rbsLastSearch';
  const DEFAULT_TYPE_KEY = 'rbsDefaultType';

  // How fresh a probe must be to describe "the current tab" (ms).
  const PROBE_FRESH_MS = 60 * 1000;

  const statusBox = document.getElementById('status');
  const defaultType = document.getElementById('defaultType');
  const openRbs = document.getElementById('openRbs');
  const clearPrefs = document.getElementById('clearPrefs');

  function setStatus(kind, text) {
    statusBox.className = 'pop-status pop-' + kind;
    statusBox.textContent = text;
  }

  function queryActiveTab() {
    return new Promise((resolve) => {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          resolve((tabs && tabs[0]) || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function loadStored(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (res) => resolve(res || {}));
      } catch (e) {
        resolve({});
      }
    });
  }

  function populateTypes(roomTypes, selected) {
    // Keep the first "(remember last used)" option, append the rest.
    while (defaultType.options.length > 1) defaultType.remove(1);
    for (const t of roomTypes || []) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      defaultType.appendChild(opt);
    }
    if (selected) defaultType.value = selected;
  }

  async function init() {
    const stored = await loadStored([PROBE_KEY, LAST_SEARCH_KEY, DEFAULT_TYPE_KEY]);
    const savedType = stored[DEFAULT_TYPE_KEY] || '';
    const probe = stored[PROBE_KEY] || null;
    const lastSearch = stored[LAST_SEARCH_KEY] || null;

    // Seed the type dropdown from the last search so there's something useful
    // even when we can't read a fresh probe.
    const seedTypes = lastSearch && lastSearch.roomType ? [lastSearch.roomType] : [];
    populateTypes(seedTypes, savedType);

    const tab = await queryActiveTab();
    const onRbs = !!(tab && tab.url && tab.url.indexOf(RBS_ORIGIN) === 0);

    if (!onRbs) {
      setStatus('warn', 'This tab is not RBS. Use “Open RBS” to go to the booking page.');
      return;
    }

    // Use the probe only if it is fresh and matches the current tab URL.
    const probeFresh =
      probe &&
      typeof probe.at === 'number' &&
      Date.now() - probe.at < PROBE_FRESH_MS &&
      tab.url &&
      probe.url === tab.url;

    if (!probeFresh) {
      setStatus(
        'info',
        'On RBS. Open or reload the search page so the extension can read its controls.'
      );
      return;
    }

    if (!probe.isSearchPage) {
      setStatus('info', 'On RBS, but not the search page. Use “Open RBS”.');
      return;
    }

    populateTypes(probe.roomTypes && probe.roomTypes.length ? probe.roomTypes : seedTypes, savedType);

    if (probe.missing && probe.missing.length > 0) {
      setStatus(
        'warn',
        'RBS page changed — controls not found: ' +
          probe.missing.map((id) => '#' + id).join(', ')
      );
    } else {
      setStatus('ok', 'On the RBS search page — all expected controls found.');
    }
  }

  defaultType.addEventListener('change', () => {
    try {
      chrome.storage.local.set({ [DEFAULT_TYPE_KEY]: defaultType.value });
    } catch (e) {
      /* ignore */
    }
  });

  openRbs.addEventListener('click', () => {
    try {
      chrome.tabs.create({ url: SEARCH_URL });
    } catch (e) {
      /* ignore */
    }
  });

  clearPrefs.addEventListener('click', () => {
    try {
      chrome.storage.local.remove([LAST_SEARCH_KEY, DEFAULT_TYPE_KEY], () => {
        defaultType.value = '';
        setStatus('ok', 'Saved preferences cleared.');
      });
    } catch (e) {
      /* ignore */
    }
  });

  init();
})();
