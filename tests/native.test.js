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
