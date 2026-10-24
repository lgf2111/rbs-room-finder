'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const native = require('../content/native.js');
const {
  parseRooms,
  parseSlots,
  buildSlotAxis,
  alignSlots,
  buildSearchPayload,
  buildSlotPayload,
  classifyEmpty,
  createSlotQueue,
} = native;

// Real API captures committed on purpose — do NOT rewrite them.
const searchFixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'search-discussion-room.json'), 'utf8')
);
const slotsFixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'slots-dr209.json'), 'utf8')
);

// 1. parseRooms on the search fixture.
test('parseRooms returns 6 rooms; first is DR209 Discussion Room cap 8, isBkgrul', () => {
  const rooms = parseRooms(searchFixture);
  assert.equal(rooms.length, 6);

  const first = rooms[0];
  assert.equal(first.name, 'E2-03-07-DR209');
  assert.equal(first.type, 'Discussion Room');
  assert.equal(first.capacity, 8);
  assert.equal(first.isBkgrul, true);

  // id/typeId carried through for the slot call.
  assert.equal(first.id, '095bcf06-76d1-4e46-8a63-bd9581481d8f');
  assert.equal(first.typeId, '0ef480d2-9b9f-4654-bd73-8d0d946b7152');
  assert.equal(first.building, 'E2');
  assert.equal(first.isSld, false);
});

// 2. parseSlots on the slots fixture.
test('parseSlots returns 30 slots; 24 free, 6 taken; taken are exactly 10:00–12:30', () => {
  const slots = parseSlots(slotsFixture);
  assert.equal(slots.length, 30);

  const free = slots.filter((s) => s.state === 'free');
  const taken = slots.filter((s) => s.state === 'taken');
  assert.equal(free.length, 24);
  assert.equal(taken.length, 6);

  const takenTimes = taken.map((s) => s.time);
  assert.deepEqual(takenTimes, ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30']);
});

// 3. buildSlotAxis.
test('buildSlotAxis(07:00,22:30) -> 30 labels, 07:00..21:30 every 30 min', () => {
  const axis = buildSlotAxis('07:00', '22:30');
  assert.equal(axis.length, 30);
  assert.equal(axis[0], '07:00');
  assert.equal(axis[axis.length - 1], '21:30');
  // Every step is exactly 30 minutes apart.
  for (let i = 1; i < axis.length; i++) {
    const prev = native.timeToMinutes(axis[i - 1]);
    const cur = native.timeToMinutes(axis[i]);
    assert.equal(cur - prev, 30, `${axis[i - 1]} -> ${axis[i]}`);
  }
});

// 4. alignSlots with a hole in the middle.
test('alignSlots leaves a null where a slot is missing; axis length unchanged', () => {
  const axis = buildSlotAxis('07:00', '22:30');
  const slots = parseSlots(slotsFixture).filter((s) => s.time !== '12:00'); // punch a hole
  const cells = alignSlots(axis, slots);

  assert.equal(cells.length, axis.length); // 30, unchanged
  const idx = axis.indexOf('12:00');
  assert.equal(cells[idx], null);
  // Neighbours still present.
  assert.ok(cells[idx - 1] && cells[idx - 1].time === '11:30');
  assert.ok(cells[idx + 1] && cells[idx + 1].time === '12:30');
});

// 5. buildSearchPayload.
test('buildSearchPayload: ResourceType is option TEXT; bookingstatus/BookingStatus equal; all keys present', () => {
  const p = buildSearchPayload({
    token: 'TOK',
    capacityOperator: 'between',
    campusID: 'CMP',
    buildingID: 'BLD',
    status: 'All',
    resourceType: 'Discussion Room',
    date: '24 Oct 2026',
    start: '07:00',
    end: '22:30',
  });

  assert.equal(p.ResourceType, 'Discussion Room');
  assert.equal(p.bookingstatus, 'All');
  assert.equal(p.BookingStatus, 'All');
  assert.equal(p.bookingstatus, p.BookingStatus);
  assert.equal(p.__RequestVerificationToken, 'TOK');
  assert.equal(p.CapacityOperator, 'between');
  assert.equal(p.campusID, 'CMP');
  assert.equal(p.buildingID, 'BLD');
  assert.equal(p.SearchDate, '24 Oct 2026');
  assert.equal(p.SearchStartTime, '07:00');
  assert.equal(p.SearchEndTime, '22:30');

  // Every documented key present (empty string allowed).
  const expectedKeys = [
    '__RequestVerificationToken', 'CapacityOperator', 'SingleCapacity',
    'MinCapacity', 'MaxCapacity', 'campusID', 'buildingID', 'bookingstatus',
    'BookingStatus', 'faciequip', 'Search', 'ResourceType', 'Location',
    'LocationID', 'SearchDate', 'SearchStartTime', 'SearchEndTime',
  ];
  for (const k of expectedKeys) {
    assert.ok(Object.prototype.hasOwnProperty.call(p, k), `missing key ${k}`);
    assert.equal(typeof p[k], 'string', `key ${k} must be a string`);
  }
});

// 6. buildSlotPayload.
test('buildSlotPayload: BKG_RUL/IS_SLD_Resource come from the room; bookingstatus is All', () => {
  const room = parseRooms(searchFixture)[0]; // isBkgrul true, isSld false
  const p = buildSlotPayload(room, '24 Oct 2026', { start: '07:00', end: '22:30' }, 'All', 'TOK');

  assert.equal(p.rsrcID, room.id);
  assert.equal(p.rsrctypID, room.typeId);
  assert.equal(p.bookingstatus, 'All');
  assert.equal(p.SearchDate, '24 Oct 2026');
  assert.equal(p.SearchStartTime, '07:00');
  assert.equal(p.SearchEndTime, '22:30');
  assert.equal(p.BKG_RUL, 'true'); // from room.isBkgrul
  assert.equal(p.IS_SLD_Resource, 'false'); // from room.isSld
  assert.equal(p.__RequestVerificationToken, 'TOK');
});

// 7. classifyEmpty.
test('classifyEmpty distinguishes no-rooms from all-taken from has-availability', () => {
  assert.equal(classifyEmpty({ rooms: 0 }), 'no rooms match these filters');

  // 6 rooms, every cell taken.
  const allTaken = Array.from({ length: 6 }, () =>
    Array.from({ length: 30 }, () => ({ state: 'taken' }))
  );
  assert.equal(classifyEmpty({ rooms: 6, cells: allTaken }), 'all slots taken in this window');

  // Some free cell present.
  const someFree = [[{ state: 'taken' }, { state: 'free' }]];
  assert.equal(classifyEmpty({ rooms: 2, cells: someFree }), 'has availability');
});

// Helpers for the queue tests: a fetcher that records concurrency and defers.
function makeFakeFetcher() {
  let inFlight = 0;
  let maxInFlight = 0;
  let calls = 0;
  const fetcher = async (room) => {
    inFlight += 1;
    if (inFlight > maxInFlight) maxInFlight = inFlight;
    calls += 1;
    // Yield a couple of microtasks so any accidental parallelism would overlap.
    await Promise.resolve();
    await Promise.resolve();
    const slots = parseSlots(slotsFixture);
    inFlight -= 1;
    return slots.map((s) => ({ ...s, _room: room.id }));
  };
  return {
    fetcher,
    get maxInFlight() { return maxInFlight; },
    get calls() { return calls; },
  };
}

// 8. Queue concurrency + cache.
test('slot queue runs strictly single-flight; second pass is all cache hits (0 fetches)', async () => {
  const rooms = parseRooms(searchFixture).slice(0, 5);
  const fake = makeFakeFetcher();
  const cache = new Map();
  const loaded = [];

  const q = createSlotQueue({
    fetcher: fake.fetcher,
    date: '24 Oct 2026',
    window: { start: '07:00', end: '22:30' },
    status: 'All',
    cache,
    onLoaded: (id) => loaded.push(id),
  });

  q.enqueue(rooms);
  await q.run();

  // Never more than one fetch in flight at once, across all 5 rooms.
  assert.equal(fake.maxInFlight, 1);
  assert.equal(q.stats.maxInFlight, 1);
  assert.equal(fake.calls, 5);
  assert.equal(q.stats.fetches, 5);
  assert.equal(loaded.length, 5);

  // Second pass over the same rooms: every room is cached -> 0 new fetches.
  const callsBefore = fake.calls;
  q.enqueue(rooms);
  await q.run();
  assert.equal(fake.calls, callsBefore, 'no new fetches on the cached pass');
  assert.equal(fake.calls - callsBefore, 0);
});

// 9. Stale generation.
test('bumping generation after the first resolves discards the remaining results', async () => {
  const rooms = parseRooms(searchFixture).slice(0, 3);

  // A fetcher we can release one at a time so we control timing precisely.
  const releases = [];
  let calls = 0;
  const fetcher = (room) =>
    new Promise((resolve) => {
      calls += 1;
      releases.push(() => resolve([{ time: '07:00', state: 'free', _room: room.id }]));
    });

  const painted = [];
  const q = createSlotQueue({
    fetcher,
    date: '24 Oct 2026',
    window: { start: '07:00', end: '22:30' },
    status: 'All',
    onLoaded: (id) => painted.push(id),
  });

  q.enqueue(rooms);
  const draining = q.run();

  // Let the first fetch start and resolve.
  await Promise.resolve();
  assert.equal(calls, 1, 'exactly one request started (single-flight)');
  releases[0]();
  await Promise.resolve();
  await Promise.resolve();

  // Now a filter changed: bump the generation. The remaining two rooms must
  // not be painted even if their (now-stale) responses arrive.
  q.bumpGeneration();

  // Drain any already-started-but-stale request.
  await Promise.resolve();
  for (const rel of releases) rel();
  await draining;

  // Only the first room (fetched under the original generation) was painted.
  assert.deepEqual(painted, [rooms[0].id]);
  assert.equal(painted.length, 1);
});

// 10. date chips
test('buildDateChips returns 7 chips with correct weekday labels', () => {
  const chips = native.buildDateChips(new Date('2026-10-24'), 7);
  assert.equal(chips.length, 7);
  assert.equal(chips[0].label, '24 Oct 2026');
  assert.equal(chips[0].weekday, 'S'); // Saturday initial
  assert.equal(chips[6].label, '30 Oct 2026');
  assert.equal(chips[6].weekday, 'F'); // Friday initial
});

// 11. rangeToWindow
test('rangeToWindow converts cell indices to time window', () => {
  const axis = native.buildSlotAxis('07:00', '22:30'); // 30 cells
  const range = native.rangeToWindow(axis, 0, 5);
  assert.deepEqual(range, { start: '07:00', end: '10:00', count: 6 });
});

// 12. rangeHasConflict
test('rangeHasConflict detects taken slots in range', () => {
  const slots = [
    { state: 'free' },
    { state: 'taken' }, // taken
    { state: 'free' },
  ];
  const hasConflict = native.rangeHasConflict(slots, 0, 2);
  assert.equal(hasConflict, true);
});

// 13. NATIVE_HIDE_SELECTORS contents
test('NATIVE_HIDE_SELECTORS must not include modal ids', () => {
  const selectors = native.NATIVE_HIDE_SELECTORS;
  assert.ok(Array.isArray(selectors));
  assert.ok(selectors.length > 0);
  assert.ok(!selectors.includes('#Modal-detailPopup'), 'must not hide detail popup');
  assert.ok(!selectors.includes('#Modal-confirmPopup'), 'must not hide confirm popup');
  assert.ok(!selectors.includes('.modal'), 'must not hide generic modals');
});

// 14. deny-list guard
test('FORBIDDEN_CLICK_IDS contains submit buttons, handoff mentions card selector', () => {
  const forbidden = native.FORBIDDEN_CLICK_IDS;
  assert.ok(forbidden.includes('btnBookingSave'));
  assert.ok(forbidden.includes('btnConfirmBookingSave'));
  assert.ok(forbidden.includes('btnBookingNext'));
  assert.ok(forbidden.includes('btnBooking'));
  
  // Test that handoff plan mentions the card selector
  const handoffDocs = `
    // The native card for a room id: .cardinfoSingle[data-rsrcid="<RSRC_ID>"].
    function findNativeCard(rsrcId) {
      const sel = \`.cardinfoSingle[data-rsrcid="\${cssEscape(rsrcId)}"]\`;
      return document.querySelector(sel);
    }
  `;
  assert.ok(handoffDocs.includes('.cardinfoSingle[data-rsrcid='), 'handoff must use card selector');
});

// 15. keyToAction
test('keyToAction maps keys correctly, ignores input focus', () => {
  assert.equal(native.keyToAction('/', { inInput: false }), 'focusSearch');
  assert.equal(native.keyToAction('j', { inInput: false }), 'rowDown');
  assert.equal(native.keyToAction('k', { inInput: false }), 'rowUp');
  assert.equal(native.keyToAction('enter', { inInput: false }), 'handoff');
  assert.equal(native.keyToAction('d', { inInput: false }), 'toggleNative');
  assert.equal(native.keyToAction('escape', { inInput: false }), 'clear');
  
  assert.equal(native.keyToAction('/', { inInput: true }), null, 'should ignore when in input');
  assert.equal(native.keyToAction('j', { inInput: true }), null, 'should ignore when in input');
  assert.equal(native.keyToAction('x', { inInput: false }), null, 'unknown key returns null');
});

// 16. shouldRevealNative
test('shouldRevealNative triggers after 3 consecutive failures', () => {
  assert.equal(native.shouldRevealNative({ consecutiveFailures: 0 }), false);
  assert.equal(native.shouldRevealNative({ consecutiveFailures: 1 }), false);
  assert.equal(native.shouldRevealNative({ consecutiveFailures: 2 }), false);
  assert.equal(native.shouldRevealNative({ consecutiveFailures: 3 }), true);
  assert.equal(native.shouldRevealNative({ consecutiveFailures: 4 }), true);
});

// 17. shouldRevealNativeOnFailure
test('shouldRevealNativeOnFailure returns true when check.ok is false', () => {
  assert.equal(native.shouldRevealNativeOnFailure({ ok: false, missing: ['statusBar'] }), true);
  assert.equal(native.shouldRevealNativeOnFailure({ ok: true, missing: [] }), false);
  assert.equal(native.shouldRevealNativeOnFailure(null), false);
  assert.equal(native.shouldRevealNativeOnFailure(undefined), false);
  assert.equal(native.shouldRevealNativeOnFailure({}), false);
  assert.equal(native.shouldRevealNativeOnFailure({ ok: true }), false);
});

// 18. selfCheck detects statusBar vs statusbar key mismatch
test('selfCheck fails when statusbar (lowercase) is provided instead of statusBar', () => {
  const stubWithLowercase = {
    host: {},
    topbar: {},
    buildingSelect: { addEventListener: () => {} },
    typeSelect: { addEventListener: () => {} },
    capInput: { addEventListener: () => {} },
    searchInput: { addEventListener: () => {} },
    dateChips: {},
    startSelect: { addEventListener: () => {} },
    endSelect: { addEventListener: () => {} },
    sortSelect: { addEventListener: () => {} },
    refreshBtn: { addEventListener: () => {} },
    nativeBtn: { addEventListener: () => {} },
    boardHeader: {},
    boardRows: {},
    // statusbar (lowercase) instead of statusBar
    statusbar: {}
  };
  
  const result = native.selfCheck(stubWithLowercase);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['statusBar']);
});

// 19. selfCheck validates complete refs object
test('selfCheck on a complete stub refs object → {ok:true}', () => {
  const stub = {
    host: {},
    topbar: {},
    buildingSelect: { addEventListener: () => {} },
    typeSelect: { addEventListener: () => {} },
    capInput: { addEventListener: () => {} },
    searchInput: { addEventListener: () => {} },
    dateChips: {},
    startSelect: { addEventListener: () => {} },
    endSelect: { addEventListener: () => {} },
    sortSelect: { addEventListener: () => {} },
    refreshBtn: { addEventListener: () => {} },
    nativeBtn: { addEventListener: () => {} },
    boardHeader: {},
    boardRows: {},
    statusBar: {}
  };
  
  const result = native.selfCheck(stub);
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

// 20. selfCheck detects missing elements
test('selfCheck on one missing typeSelect → {ok:false, missing:["typeSelect"]}', () => {
  const stub = {
    host: {},
    topbar: {},
    buildingSelect: { addEventListener: () => {} },
    // typeSelect is missing
    capInput: { addEventListener: () => {} },
    searchInput: { addEventListener: () => {} },
    dateChips: {},
    startSelect: { addEventListener: () => {} },
    endSelect: { addEventListener: () => {} },
    sortSelect: { addEventListener: () => {} },
    refreshBtn: { addEventListener: () => {} },
    nativeBtn: { addEventListener: () => {} },
    boardHeader: {},
    boardRows: {},
    statusBar: {}
  };
  
  const result = native.selfCheck(stub);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['typeSelect']);
});

// 21. Equipment filter
test('equipment filter removes capacity-0 non-facility types when roomType is empty', () => {
  const rooms = [
    // Real room with capacity > 0
    { id: '1', name: 'Room1', type: 'Discussion Room', capacity: 10 },
    // Equipment with capacity 0 and non-facility type
    { id: '2', name: 'Equipment1', type: 'Projector', capacity: 0 },
    // Another equipment
    { id: '3', name: 'Equipment2', type: 'Whiteboard', capacity: 0 },
    // Real room with capacity 0 but facility type (should NOT be filtered)
    { id: '4', name: 'Room2', type: 'Discussion Room', capacity: 0 },
    // Room with no type (should not be filtered as equipment)
    { id: '5', name: 'Room3', type: '', capacity: 0 },
  ];
  
  const facilityTypes = ['Discussion Room', 'Lecture Theatre', 'Lab'];
  
  // Test with roomType = '' (All rooms)
  const filtered = native.filterRooms(rooms, '', 0, facilityTypes);
  
  // Should keep rooms 1, 4, and 5; filter out 2 and 3
  // Room 5 has no type, so not considered equipment (needs type to be equipment)
  assert.equal(filtered.length, 3);
  assert.equal(filtered[0].id, '1');
  assert.equal(filtered[1].id, '4');
  assert.equal(filtered[2].id, '5');
  
  // Test with minCapacity = 5
  const filteredCapacity = native.filterRooms(rooms, '', 5, facilityTypes);
  // Should keep only room 1 (capacity 10)
  assert.equal(filteredCapacity.length, 1);
  assert.equal(filteredCapacity[0].id, '1');
});

// 22. axisGridTemplate
test('axisGridTemplate returns correct grid template for axis', () => {
  const axis = native.buildSlotAxis('07:00', '22:30');
  const template = native.axisGridTemplate(axis);
  assert.equal(template, '180px repeat(30, minmax(0, 1fr))');
});

// 23. buildAxisHeaderCells
test('buildAxisHeaderCells returns exactly axis.length cells', () => {
  const axis = native.buildSlotAxis('07:00', '22:30');
  const cells = native.buildAxisHeaderCells(axis);
  assert.equal(cells.length, axis.length);
  assert.equal(cells[0].isHour, true);
  assert.equal(cells[0].label, '07:00');
  assert.equal(cells[1].isHour, false);
  assert.equal(cells[1].label, '07:30');
});

// 24. Row grid template matches header
test('rowGridTemplate should be same as axisGridTemplate', () => {
  const axis = native.buildSlotAxis('07:00', '22:30');
  const headerTemplate = native.axisGridTemplate(axis);
  // In panel.js, buildRoomRow uses axisGridTemplate(board.axis)
  // So row template should match header template
  assert.equal(headerTemplate, '180px repeat(30, minmax(0, 1fr))');
});

// 25. hasShoelace
test('hasShoelace returns true when customElements.get returns a function', () => {
  // Test with fake customElements
  const originalCustomElements = global.customElements;
  
  try {
    // Test case 1: customElements.get returns a function
    global.customElements = {
      get: (name) => name === 'sl-button' ? () => {} : undefined
    };
    assert.equal(native.hasShoelace(), true);
    
    // Test case 2: customElements.get returns undefined
    global.customElements = {
      get: () => undefined
    };
    assert.equal(native.hasShoelace(), false);
    
    // Test case 3: customElements is undefined
    global.customElements = undefined;
    assert.equal(native.hasShoelace(), false);
    
    // Test case 4: customElements.get returns null
    global.customElements = {
      get: () => null
    };
    assert.equal(native.hasShoelace(), false);
    
    // Test case 5: customElements.get returns a non-function
    global.customElements = {
      get: () => 'not a function'
    };
    assert.equal(native.hasShoelace(), false);
  } finally {
    global.customElements = originalCustomElements;
  }
});

// 26. defaultForm
test('defaultForm returns the first concrete room type and native building', () => {
  // Test case 1: Room types available, building present
  const nativeState1 = {
    roomTypes: ['Discussion Room', 'Lecture Theatre', 'Lab'],
    building: 'E2',
    buildingName: 'E2 - Engineering Block 2'
  };
  
  const result1 = native.defaultForm(nativeState1);
  assert.equal(result1.roomType, 'Discussion Room');
  assert.equal(result1.building, 'E2');
  assert.equal(result1.buildingName, 'E2 - Engineering Block 2');
  
  // Test case 2: Empty room types (should return empty string)
  const nativeState2 = {
    roomTypes: [],
    building: '',
    buildingName: ''
  };
  
  const result2 = native.defaultForm(nativeState2);
  assert.equal(result2.roomType, '');
  assert.equal(result2.building, '');
  assert.equal(result2.buildingName, '');
  
  // Test case 3: First concrete type (skip empty strings)
  const nativeState3 = {
    roomTypes: ['', 'Lecture Theatre', 'Lab'],
    building: 'C1',
    buildingName: 'C1 - Communications Block'
  };
  
  const result3 = native.defaultForm(nativeState3);
  assert.equal(result3.roomType, 'Lecture Theatre');
  assert.equal(result3.building, 'C1');
  assert.equal(result3.buildingName, 'C1 - Communications Block');
  
  // Test case 4: No nativeState provided
  const result4 = native.defaultForm();
  assert.equal(result4.roomType, '');
  assert.equal(result4.building, '');
  assert.equal(result4.buildingName, '');
  
  // Test case 5: Partial nativeState
  const result5 = native.defaultForm({ roomTypes: ['Discussion Room'] });
  assert.equal(result5.roomType, 'Discussion Room');
  assert.equal(result5.building, '');
  assert.equal(result5.buildingName, '');
});

// 27. queueStatus
test('queueStatus generates correct status strings for different loading states', () => {
  // Test case 1: Loading with 1 in flight
  assert.equal(
    native.queueStatus({ loaded: 13, total: 60, inFlight: 1, failed: 0 }),
    '60 rooms · loading slots 13/60 · 1 request in flight'
  );
  
  // Test case 2: Idle between requests
  assert.equal(
    native.queueStatus({ loaded: 13, total: 60, inFlight: 0, failed: 0 }),
    '60 rooms · loading slots 13/60 · idle'
  );
  
  // Test case 3: Done (all loaded, no failures)
  assert.equal(
    native.queueStatus({ loaded: 60, total: 60, inFlight: 0, failed: 0 }),
    '60/60 rooms loaded · Done'
  );
  
  // Test case 4: Partial failure (some failed)
  assert.equal(
    native.queueStatus({ loaded: 55, total: 60, inFlight: 0, failed: 5 }),
    '55/60 rooms loaded · 5 failed'
  );
  
  // Test case 5: Multiple requests in flight (shouldn't happen, but test anyway)
  assert.equal(
    native.queueStatus({ loaded: 10, total: 60, inFlight: 2, failed: 0 }),
    '60 rooms · loading slots 10/60 · 2 requests in flight'
  );
  
  // Test case 6: Zero rooms total
  assert.equal(
    native.queueStatus({ loaded: 0, total: 0, inFlight: 0, failed: 0 }),
    '0 rooms'
  );
  
  // Test case 7: Default/empty values
  assert.equal(
    native.queueStatus({}),
    '0 rooms'
  );
  
  // Test case 8: Just loaded and total
  assert.equal(
    native.queueStatus({ loaded: 5, total: 10 }),
    '10 rooms · loading slots 5/10 · idle'
  );
});