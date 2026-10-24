---
name: nova-verify
description: Use when you must prove a nova UI change actually renders and behaves in the real Shadow DOM.
---

# Verifying a nova change (do this before claiming any fix)

The unit tests cover `content/native.js` only. They say nothing about whether the panel mounts,
whether options populate, whether clicks work, or whether the grid aligns. Every claim about the
UI needs a harness measurement.

## 1. Build and static gates

```sh
npm run build && git status --short      # rebuild must leave no diff
node --check content/nova.bundle.js
node --test tests/                        # 36/36
grep -c "eval(\|new Function" content/nova.bundle.js   # must be 0
```

## 2. Harness

Server: `~/.hermes/cache/scratch/rbs-harness/server.py` on `http://127.0.0.1:8787`.

| URL | Simulates |
|---|---|
| `/SRB001/SRB001Page` | normal search page (14 buildings, 17 types, GUID values) |
| `?slow=1` | options populate 1.2 s after load |
| `?novalues=1` | selects with no real options (diagnostics path) |
| `/Home/ErrorPage?code=1001&exceptionMsg=sessiontimeout` | session-expired dialog |
| `/__expire?on=1` / `?on=0` | API answers the error page as HTML at 200 / normal JSON |
| any other path | generic stub for takeover checks |

## 3. Inject exactly like the extension does

```js
// stub first: content scripts call chrome.storage.local.get(keys, cb) AND promise form
window.chrome = window.chrome || {}; const store = {};
window.chrome.storage = { local: {
  get: (k, cb) => { const o = {}; (Array.isArray(k)?k:[k]).forEach(x => { if (x in store) o[x] = store[x]; });
                    if (cb) cb(o); return Promise.resolve(o); },
  set: (o, cb) => { Object.assign(store, o); if (cb) cb(); return Promise.resolve(); },
  remove: (x, cb) => { delete store[x]; if (cb) cb(); return Promise.resolve(); } } };
// then, in order:
(0, eval)(await (await fetch('/content/native.js')).text());
(0, eval)(await (await fetch('/content/panel.js')).text());
(0, eval)(await (await fetch('/content/nova.bundle.js')).text());
```

Fetch-then-eval, not one giant CDP expression: an 85 KB `Runtime.evaluate` breaks the socket.

## 4. Assertions worth making

- exactly ONE `.nova-root` (a triple mount shipped once and tripled every request)
- native body hidden (`document.documentElement.classList.contains('rbsx-native-hidden')`)
- board: rows = rooms, cells = rows × axis slots, per-state counts from the fixtures
- request counts: 1 `SearchSRB001List`, then slot calls strictly sequential
- selects: option count per control equals the native select's option count
- header cell count == axis.length + 1, and a header cell and the row cell beneath it share
  `left` and `width` (`getBoundingClientRect`)
- hour divider sits on the `:30` cell (thick `border-right`), `:00` thin, in header and row
- cart: selecting across two rooms lists 2 items with correct windows; confirm disabled while the
  booking endpoint is unmapped
- session expired: `/__expire?on=1` then Reload → "Session expired" naming the endpoint, no rows;
  `/__expire?on=0` then Reload → rows return
- error page: no hide class, dialog visible, no nova root

## 5. Report

Numbers, not adjectives. Include the build stamp you measured (`window.__rbsBuild`) and a
screenshot path for anything visual.
