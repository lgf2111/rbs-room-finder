# RBS Room Finder

A Chrome extension (Manifest V3, no build step, vanilla JS) that adds an
**availability board** to SIT's room booking system (RBS) at
`https://rbs.singaporetech.edu.sg`.

## What it does

On the search page (`/SRB001/SRB001Page`) it injects a floating panel inside a
**shadow root** (so the WebForms styles and the panel styles stay isolated from
each other). You pick a room type, a date, a day window, a minimum capacity and
a sort order, click **Load board**, and it shows **every room and every 30-minute
slot** for that date at once — no clicking into individual room cards.

On any other RBS page it injects only a small launcher button linking to the
search page.

The board is filled **lazily**: all rooms render immediately as skeleton rows,
then each room's slots are fetched one request at a time (see "Why requests are
serialised" below). Rooms you scroll into view jump the queue.

## The two endpoints it calls

Both are **same-origin POSTs** from the content script with:

```
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
X-Requested-With: XMLHttpRequest
```

They return JSON — no postback, no page navigation, no `__VIEWSTATE`. Same-origin
fetch needs no extra permission beyond the RBS host permission. The anti-forgery
token is read **fresh before every call** from
`input[name=__RequestVerificationToken]`.

### 1) Room list — `POST /SRB001/SearchSRB001List`

Request fields (all strings; `''` allowed):

| field | source |
| --- | --- |
| `__RequestVerificationToken` | hidden input, read fresh |
| `CapacityOperator` | `#srcCapacityOperator` (e.g. `between`) |
| `SingleCapacity`, `MinCapacity`, `MaxCapacity` | capacity filters, `''` when unused |
| `campusID` | `#campus` value |
| `buildingID` | `#building` value |
| `bookingstatus` **and** `BookingStatus` | both equal (`All` \| `Available`) |
| `faciequip` | facilities |
| `Search` | free-text substring, `''` |
| `ResourceType` | the option **TEXT** of `#resourceType` (e.g. `Discussion Room`); `''` = all types |
| `Location`, `LocationID` | `''` |
| `SearchDate` | date text as in `#searchSlotDate`, e.g. `24 Oct 2026` |
| `SearchStartTime`, `SearchEndTime` | `HH:MM`, e.g. `07:00` / `22:30` |

Response: a JSON array of rooms. Fields used:
`RSRC_ID`, `RSRC_NAME`, `SERIAL_NUM`, `CAPACITY`, `RSRC_TYP_ID`,
`RSRC_TYP_NAME`, `BLDNG_NAME`, `IS_BKGRUL`, `IS_SLD`, `IS_BOOKABLE`,
`IS_PERMITTED`, `Event_Type`, `Paragraph`, `DISCLAIMER`.

Confirmed live: `ResourceType: ''` returned **28** rooms across types in
building E2; `ResourceType: 'Discussion Room'` returned **6**.

### 2) Slots for one room — `POST /SRB001/GetTimeSlotListByresidNdatetime`

Request fields:

| field | source |
| --- | --- |
| `__RequestVerificationToken` | hidden input, read fresh |
| `rsrcID` | room's `RSRC_ID` |
| `rsrctypID` | room's `RSRC_TYP_ID` |
| `bookingstatus` | `All` (returns every slot with a status) |
| `SearchDate` | same date text |
| `SearchStartTime`, `SearchEndTime` | the day window, e.g. `07:00` / `22:30` |
| `BKG_RUL` | room's `IS_BKGRUL` |
| `IS_SLD_Resource` | room's `IS_SLD` |

Response: a JSON array of slots, one per 30 minutes. For `07:00`–`22:30` it
returns **30** entries. Fields: `SLT_ID`, `SLT_Time` (`1400`), `SLT_Desc`
(`14:00`), `SLT_STATUS`, `SLT_Date_Time`, `Quota`, `canBooked`, `isConflict`.

`SLT_STATUS` mapping (**verified live**): `1` = free, `3` = booked/blocked;
anything else is treated as unknown. `canBooked` was `false` on every slot in
every probe, so it is **ignored** — it is never used to decide anything.

## Measured latencies and why requests are serialised

Measured on the live, authenticated site:

- `SearchSRB001List`: **~1.8–2.3 s**.
- `GetTimeSlotListByresidNdatetime`: **~2.1–2.2 s per room**.
- **Requests do not parallelise.** 6 concurrent slot calls took ~13.7 s; 2
  sequential calls took ~4.3 s. The server serialises per session.

So the board uses a strict **single-flight queue**: exactly **one** slot request
is in flight at any moment, ever — the room-loading path never uses
`Promise.all`. The header shows `n/m rooms loaded` and a hint of the remaining
time (~2.2 s/room).

## Lazy fill, cache and the generation counter

- The room list arrives first; every room renders immediately as a **skeleton**
  row of shimmering cells on a shared time axis (a sticky header labels each
  hour with half-hour ticks).
- A single-flight queue then fills rooms **in DOM order**, but blocks currently
  in the viewport **jump the queue** (via `IntersectionObserver`).
- Each slot response is **cached in memory** keyed `rsrcId|date|window|status`.
  A re-render never refetches a cached room (a second pass over the same rooms
  performs zero fetches).
- Changing type/date/window/capacity **bumps a generation counter** and abandons
  the in-flight queue's results: a response that arrives after the generation
  changed is cached but **never painted** (no stale paint).
- Cell states: **free** (green), **taken** (red, `title` names the status),
  **unknown / not-yet-loaded** (skeleton shimmer). Slots whose start falls
  outside the chosen window are still drawn but **dimmed** so the axis is stable.
- On a per-room fetch error the block is marked **"failed — retry"** with a retry
  button, and the queue keeps going.
- Sort by **room name** (default) or **capacity descending**.

## Empty / failure states

- **Zero rooms from the search** → "No rooms match these filters."
- **Rooms exist but every cell is taken** → "All N room(s) are fully taken for
  this window." (distinguished by the cell counts via `classifyEmpty`).
- A capacity filter that removes everything says how many the search returned.
- A **4xx/5xx or unparseable JSON** → "the RBS API returned an error (HTTP n)"
  and the **previous board is left intact**.
- If any required native control is missing (`#resourceType`, `#searchSlotDate`,
  `#SearchHoursFrom`, `#SearchHoursTo`, `#btnBookingMainSearch`, `#building`,
  `#campus`) → "RBS page changed — controls not found: #x, #y" and nothing else.

## Booking is always manual (the panel never submits)

Each room block has a **Book** action. It dispatches a real click on the native
room card `document.querySelector('.cardinfoSingle[data-rsrcid="<RSRC_ID>"]')`
and lets the native handler decide what happens:

- rooms with `data-isbkgrul="true"` open the detail popup (`#Modal-detailPopup`);
- others get selected and bump the native "N Facility Selected" badge.

Within ~2.5 s the panel verifies **either** `#Modal-detailPopup` is visible
**or** the selected badge text is present. If neither appears it tells you the
selection did not take and to click the room card yourself — it **never claims
success** without one of those two signals. It then scrolls the native action
bar into view with the note:

> Confirm below — nothing is booked until you click Book.

The extension **never clicks** `btnBookingSave`, `btnConfirmBookingSave`,
`btnBookingNext`, `btnBooking`, any `btnMultipleBookingConfirm*`,
`btnBookingMainClear`, or any submit. Selection and scrolling only.

## No credentials, no remote code

This extension never touches authentication (the SIT ADFS login is entirely the
browser's own session). It has no analytics, no remote code, no `eval`, and no
third-party libraries. The only persistence API it uses is
`chrome.storage.local`, to remember your last board filters and show the popup's
status line. The manifest declares only the `storage` permission plus the RBS
host permission (same-origin fetch needs nothing more).

## Install (unpacked)

1. Clone or download this folder.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select this project folder (the one containing
   `manifest.json`).
5. Open `https://rbs.singaporetech.edu.sg/SRB001/SRB001Page` and sign in as
   usual. The availability board panel appears on the page.

No icons are bundled, so Chrome shows its default placeholder icon in the
toolbar.

## Project layout

```
manifest.json
content/panel.js      board UI, API fetch layer, queue + cache + render, Book action
content/panel.css     panel styles (kept in sync with the embedded PANEL_CSS)
content/native.js     pure API/parsing functions, shared with tests
popup/popup.html
popup/popup.js
popup/popup.css
tests/native.test.js
tests/fixtures/search-discussion-room.json   real room-list capture (6 rooms)
tests/fixtures/slots-dr209.json              real slot capture (30 slots)
README.md
```

## Tests

The pure functions in `content/native.js` run in both the browser and Node.

```
node --test tests/
```

Coverage: `parseRooms` and `parseSlots` on the real captures, `buildSlotAxis`
and `alignSlots`, both payload builders, `classifyEmpty`, and the single-flight
queue — including that max-in-flight is exactly **1** over 5 rooms, that a second
pass is all cache hits (0 fetches), and that bumping the generation after the
first room resolves discards the remaining results instead of painting them.
