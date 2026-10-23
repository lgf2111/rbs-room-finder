# RBS Room Finder

A Chrome extension (Manifest V3, no build step, vanilla JS) that adds a modern
search UI to SIT's room booking system (RBS) at
`https://rbs.singaporetech.edu.sg`.

## What it does

RBS is an ASP.NET WebForms app where search is a full page **postback**: the
page posts its whole form back (with `__VIEWSTATE`) and the server re-renders
with results. This extension does **not** reimplement or call that endpoint —
that cannot work without the server's VIEWSTATE. Instead it **drives the native
controls** (room type, date, start/end time, status) and clicks the real search
button, then reads the re-rendered page and presents the results in a clean
panel.

On the search page (`/SRB001/SRB001Page`) it injects a floating panel inside a
**shadow root** so the WebForms styles and the panel styles stay isolated from
each other. On any other RBS page it injects only a small launcher button that
links to the search page.

Features:

- Pick room type (read from the live page), date (today + next 7 days), start
  and end time (30-minute steps, 07:00–22:30), and a minimum capacity.
- Result cards show room name, capacity, and the window, sorted by capacity
  (largest first).
- Distinguishes an empty result as either **all booked** (rooms exist for that
  category/date but none are free for your window) or **no such rooms** (the
  category/date has nothing), by re-checking the same window with status `All`.
- A **Book** button ticks that room's checkbox in the native results list and
  scrolls the native booking form into view. It never submits anything.
- Remembers your last search and offers a "Reuse last search" chip.

## "Available" means the entire window

A room is listed as available only if it is free for the **entire window** you
pick (start to end), not merely for part of it. The panel states this inline.

## Booking is always manual

RBS results are Bootstrap cards with no per-room checkbox; selection happens by
**clicking the room card**. So the panel's **Book** button finds that room's
card on the native page, scrolls it into view, clicks it to select the room,
and then scrolls the native action bar (the real **Book** / **Next** control and
the "1 Facility Selected" badge) into view, with the note:

> 1 Facility Selected — confirm Book below; nothing is booked until you click Book.

You must click the native **Book** button yourself to reserve anything. The
extension never clicks `btnBookingSave`, `btnBookingNext`, `btnBookingMainClear`
or any submit, and never auto-submits a booking. If the "Facility Selected"
badge does not appear within ~2 seconds of the click, the panel tells you the
selection did not take rather than claiming success.

## No credentials, no network calls of its own

This extension never touches authentication (SIT ADFS login is entirely the
browser's own session) and makes **no network calls of its own**. It has no
analytics, no remote code, no `eval`, and no third-party libraries. The only
browser API it uses for persistence is `chrome.storage.local`, to remember your
last search and your default room type.

## Install (unpacked)

1. Clone or download this folder.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select this project folder (the one containing
   `manifest.json`).
5. Open `https://rbs.singaporetech.edu.sg/SRB001/SRB001Page` and sign in as
   usual. The RBS Room Finder panel appears on the page.

No icons are bundled, so Chrome shows its default placeholder icon in the
toolbar.

## How it drives the page (and why it waits)

RBS triggers a server postback after several control changes. The driving layer
obeys these rules, which must not be weakened:

1. It waits ~1200 ms after each control change so the postback can re-render
   before touching the next control.
2. It re-reads all four values (type, date, start, end) **before** clicking
   Search. If a change was still in flight the native selects silently reset,
   so it sets them again and only then clicks.
3. After results render it re-reads the selectors. If they no longer show the
   requested window, the result is marked untrusted in the UI rather than shown.
4. Results on the live site are Bootstrap cards: the room name lives in
   `div.resourceName` as `NAME/TYPE` and the capacity lives in a following
   sibling as `Capacity: N`. The parser pairs each `resourceName` with the next
   `Capacity: N`, splits `NAME/TYPE` on the first `/` into `room` and `type`,
   and dedupes by the `room` code. An older single-string row shape
   (`NAME/TYPE Capacity: N` in one text node) is kept working as a fallback for
   text-only captures, but the card path is primary. No name ever carries
   `Capacity:`.
5. `#resourceType` is a select2 widget — the visible element is a rendered span
   and the real `<select>` is hidden and re-initialised after every postback.
   The driver sets the hidden `<select>` and dispatches a bubbling `change`, and
   **re-queries the element on every step** rather than caching it. Option
   values are matched by their visible text (never by position): `#resourceType`
   values are GUIDs, and `#SearchHoursFrom` starts at `00:00`, so "first option"
   is never assumed to be a particular time.
6. The "No resources with available time slots found" toast persists across
   searches, so the verdict is decided from the room count, never the toast.

## Design notes / decisions

- **Popup status without extra permissions.** The manifest declares only the
  `storage` permission (plus the RBS host permission). To show "is this tab RBS
  and were the controls found?" the content script publishes a small snapshot
  of the current page to `chrome.storage.local` under `rbsProbe`, and the popup
  reads it. This avoids the `scripting` permission that `executeScript` would
  require, keeping the permission set minimal as specified.
- **Panel injection gate.** The full search panel is injected only when ALL of
  `#resourceType`, `#searchSlotDate`, `#SearchHoursFrom`, `#SearchHoursTo` and
  `#btnBookingMainSearch` are present. Other pages on the RBS origin (e.g. My
  Bookings at `/DHB001/DHB001Page`, which has `#resourceType` and
  `#searchSlotDate` but not the time selects or the search button) get only the
  launcher button, so no dead panel appears off the search page.
- **Shadow-root styling.** `content/panel.css` is listed in the manifest for
  completeness, but the panel and launcher live in shadow roots, so panel.js
  also injects an equivalent stylesheet string (`PANEL_CSS`) directly into each
  shadow root. This is what guarantees WebForms CSS cannot leak in and ours
  cannot leak out, without needing `web_accessible_resources`.

## Project layout

```
manifest.json
content/panel.js      UI + native driving/rendering (content script)
content/panel.css     panel styles (also embedded into the shadow root)
content/native.js     pure WebForms parsing/plan functions, shared with tests
popup/popup.html
popup/popup.js
popup/popup.css
tests/native.test.js
tests/fixtures/results.html
README.md
```

## Tests

The pure functions in `content/native.js` run in both the browser and Node.

```
node --test tests/
```

They cover results parsing and dedupe, the search-plan builder (including
rejecting an unknown room type or an end-before-start window), date/window
formatting, and the empty-result classification.
