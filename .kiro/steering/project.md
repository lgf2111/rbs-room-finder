# RBS Room Finder — project steering (loaded on every run)

## What this is

A Chrome MV3 extension that replaces SIT's RBS room-booking site
(`https://rbs.singaporetech.edu.sg/*`) with a modern UI. The owner books rooms weekly; the
extension must never break his ability to book. "Nova" is the internal codename for the
React rewrite (bundle `content/nova.bundle.js`, opt-out flag `?nova=0`).

## Stack and build

- `content/native.js` — pure data/parse/queue layer. **DO NOT EDIT.** 36 node tests depend on it.
- `content/panel.js` — the previous vanilla panel. Still reachable via `?nova=0`, still defines
  `window.__rbsBridge`. Treat as legacy: do not grow it.
- `src/` — React 18 + shadcn/ui (Radix) + Tailwind, built by `scripts/build.mjs` (esbuild) into
  ONE committed IIFE `content/nova.bundle.js`. `npm run build` must be deterministic: a rebuild
  leaves no `git diff`.
- Everything ships bundled: no ESM at runtime, no CDN, no remote code, no `eval`/`new Function`.
- Rendering target is a **Shadow DOM** (`#rbs-room-finder-host`). Tailwind CSS is injected as a
  `<style>` inside that root. Radix portals MUST use the container inside the shadow root
  (`#nova-portal` via the portal provider) or dropdowns/dialogs render unstyled.
- Permissions are fixed: `storage` + host permission for the RBS origin. Never add more.

## Hard rules

1. Never `git push`, never publish, never touch credentials/`.env`/keychain. Commit locally; the
   operator pushes.
2. Never click a native submit/confirm (`FORBIDDEN_CLICK_IDS`: `btnBookingSave`,
   `btnConfirmBookingSave`, `btnBookingNext`, `btnBooking`, `btnBookingMainClear`,
   `btnMultipleBookingConfirm*`). The extension may select and scroll, never submit.
3. Hide the native DOM, never remove it — its handlers are still needed.
4. Never invent data. If an endpoint is not mapped, render an honest "not mapped" screen naming
   it. No fake rows, no fake bookings, no placeholder statistics.
5. `node --test tests/` must stay 36/36. `node --check content/nova.bundle.js` must pass.
6. Report measured numbers, not impressions. If you did not measure it, say so.

## Verified facts about the real site (measured, do not re-derive)

- Two JSON endpoints, same-origin POST with `__RequestVerificationToken`:
  `POST /SRB001/SearchSRB001List` (rooms, ~1.8–2.3 s) and
  `POST /SRB001/GetTimeSlotListByresidNdatetime` (slots for ONE room, ~2.1–2.2 s). The server
  serialises per session: exactly ONE slot request in flight, never `Promise.all`.
- `SLT_STATUS`: 1 = free, 3 = taken, 7 = not open (closed) — 7 has its own visual state.
- The site is jQuery + **select2**: `#building` (14 options: placeholder "Building" + E1..E13,
  GUID values), `#resourceType` (17 options: "Resource Type" + types, GUID values), `#campus`,
  `#SearchHoursFrom`/`#SearchHoursTo` ("07:00" … "22:30" in 30-min steps). Classes are
  `form-control ims-select2 select2-hidden-accessible`. Options are read from the `<select>`s.
- Room photos exist ONLY in the native result-card markup: `[data-rsrcid][data-imgpath]` where
  `data-imgpath` is a base64 PNG with no `data:` prefix. On a page where nova rendered the board
  there are usually **0 cards**, so harvesting requires running the native search once.
  RBS's own `DISCLAIMER` says the photo is a sample/illustration, not the actual room.
- Expired session: availability POSTs answer the `/Home/ErrorPage?code=1001&exceptionMsg=sessiontimeout`
  page as **HTML at HTTP 200**. That page is a white dialog "Session Timeout/Error!" with an Ok
  button to `/Account/Login`. Nova must not take over `/Home/ErrorPage` or `/Account/Login`.
- Site map: `/DHB001/DHB001Page` Dashboard, `/SRB001/SRB001Page` New Booking,
  `/SPT001/SPT001Page` Support Booking, `/Home/UserGuidePage`, `/Home/FAQPage`,
  `/Home/SupportPage`.
- Booking endpoint is **not yet mapped** — needs one captured Network request from the user.

## Local verification harness (this is how changes are proven)

`~/.hermes/cache/scratch/rbs-harness/server.py` serves a stub RBS on `http://127.0.0.1:8787`:

- `/SRB001/SRB001Page` — stub page with the real control ids and the real select shapes
- `?slow=1` — buildings/room types populate 1.2 s AFTER load (cascade timing)
- `?novalues=1` — selects present with no real options (diagnostics path)
- `/Home/ErrorPage?code=1001&exceptionMsg=sessiontimeout` — the real session-expired dialog markup
- `/__expire?on=1` / `?on=0` — make both JSON endpoints answer with that error page as HTML at 200
- `/content/*.js` — serves repo files so a page can `fetch` + `(0,eval)` them
- any other path — generic stub, for full-site takeover checks

Verification recipe: load the stub in the automation Chrome, stub `chrome.storage.local`
(callback AND promise form), inject `content/native.js` → `content/panel.js` →
`content/nova.bundle.js` in that order, wait, then read the shadow root and assert counts
(rows, cells, per-state cells, options per select, fetch counts). Screenshot every visual claim.

## Known pitfalls (cost hours already)

- Chrome gives a content-script isolated world a **NULL `customElements` registry** — no web
  components. Probe exists; Shoelace is dead here.
- A mount-time snapshot of native options is always wrong: the cascade fills them late. Re-read
  on native `change` events and poll until the counts stabilise.
- `querySelectorAll('sl-option')` returns nothing here; read real `<option>`s.
- Header/row grids must share one template with `minmax(0, 1fr)` and the header must emit
  exactly `axis.length + 1` cells (room column + slots).
- Hour dividers belong on the `:30` cell so 07:00|07:30 read as one hour block.
- A stale unpacked extension is the #1 false bug report: always state the build (see below).
- `window.__rbsBuild = { sha, builtAt }` + a visible build line in the floor of the UI exist so
  the owner's screenshot identifies the loaded build.
