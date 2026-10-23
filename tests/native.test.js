'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const native = require('../content/native.js');
const {
  parseResults,
  buildSearchPlan,
  formatDate,
  formatWindow,
  classifyEmpty,
  filterAndSortRooms,
} = native;

const fixtureHtml = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'results.html'),
  'utf8'
);

test('parseResults returns the unique rooms with correct names and integer capacities', () => {
  const rooms = parseResults(fixtureHtml);

  // 3 rooms with full+badge, 1 anchor-only room = 4 unique rooms.
  assert.equal(rooms.length, 4);

  const byName = Object.fromEntries(rooms.map((r) => [r.name, r.capacity]));
  assert.deepEqual(byName, {
    'E2-05-12': 81,
    'SR-03-07': 40,
    'DR-01-02': 8,
    'DR-01-05': 12,
  });

  // Capacities are integers.
  for (const r of rooms) {
    assert.equal(Number.isInteger(r.capacity), true, `${r.name} capacity is integer`);
  }

  // No entry's name may contain "Capacity:".
  for (const r of rooms) {
    assert.equal(/Capacity:/i.test(r.name), false, `name "${r.name}" has no Capacity:`);
  }
});

test('duplicate rows (full row + bare badge fragment) collapse to one room', () => {
  // Craft one full row plus its bare badge fragment for the SAME room.
  const html = `
    <table>
      <tr><td><span>LT-1A/Lecture Theatre Capacity: 120 Main Hall</span></td></tr>
      <tr><td><span>Capacity: 120</span></td></tr>
    </table>
  `;
  const rooms = parseResults(html);
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].name, 'LT-1A');
  assert.equal(rooms[0].capacity, 120);
});

test('buildSearchPlan returns ordered control mutations with the right option texts', () => {
  const plan = buildSearchPlan({
    roomType: 'Discussion Room',
    date: '22 Oct 2026',
    start: '14:00',
    end: '16:00',
    minCapacity: 6,
    knownRoomTypes: ['Discussion Room', 'Seminar Room', 'ICT Laboratory'],
  });

  assert.equal(plan.settleMs, 1200);
  assert.equal(plan.minCapacity, 6);
  assert.equal(plan.status, 'Available');

  assert.deepEqual(
    plan.mutations.map((m) => [m.id, m.kind, m.value]),
    [
      ['resourceType', 'select-by-text', 'Discussion Room'],
      ['searchSlotDate', 'set-text', '22 Oct 2026'],
      ['SearchHoursFrom', 'select-by-text', '14:00'],
      ['SearchHoursTo', 'select-by-text', '16:00'],
      ['bookingstatus', 'select-by-text', 'Available'],
    ]
  );
});

test('buildSearchPlan rejects an unknown room type with a clear message', () => {
  assert.throws(
    () =>
      buildSearchPlan({
        roomType: 'Dungeon',
        date: '22 Oct 2026',
        start: '14:00',
        end: '16:00',
        knownRoomTypes: ['Discussion Room', 'Seminar Room'],
      }),
    /Unknown room type "Dungeon"/
  );
});

test('buildSearchPlan rejects an end time before start with a clear message', () => {
  assert.throws(
    () =>
      buildSearchPlan({
        roomType: 'Seminar Room',
        date: '22 Oct 2026',
        start: '16:00',
        end: '14:00',
      }),
    /End time \(14:00\) must be after start time \(16:00\)/
  );
});

test('formatDate formats as "D Mon YYYY"', () => {
  assert.equal(formatDate(new Date(2026, 9, 22)), '22 Oct 2026');
});

test('formatWindow joins with an en dash', () => {
  assert.equal(formatWindow('14:00', '16:00'), '14:00\u201316:00');
});

test('classifyEmpty distinguishes all-booked from no-such-rooms', () => {
  assert.equal(classifyEmpty({ rowsWithAll: 3, rowsAvailable: 0 }), 'all booked');
  assert.equal(classifyEmpty({ rowsWithAll: 0, rowsAvailable: 0 }), 'no such rooms');
  assert.equal(classifyEmpty({ rowsWithAll: 5, rowsAvailable: 2 }), 'has availability');
});

test('filterAndSortRooms filters by min capacity and sorts descending', () => {
  const rooms = parseResults(fixtureHtml);
  const filtered = filterAndSortRooms(rooms, 10);
  assert.deepEqual(
    filtered.map((r) => r.name),
    ['E2-05-12', 'SR-03-07', 'DR-01-05']
  );
  assert.deepEqual(
    filtered.map((r) => r.capacity),
    [81, 40, 12]
  );
});
