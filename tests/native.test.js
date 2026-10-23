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

test('parseResults parses the real Bootstrap-card fixture into exactly 4 rooms', () => {
  const rooms = parseResults(fixtureHtml);

  // The live card shape: div.resourceName "NAME/TYPE" + a following "Capacity: N".
  assert.equal(rooms.length, 4);

  // Document order is preserved and the shape is {name, room, type, capacity}.
  assert.deepEqual(rooms, [
    { name: 'E2-03-07-DR209/Discussion Room', room: 'E2-03-07-DR209', type: 'Discussion Room', capacity: 8 },
    { name: 'E2-03-08-DR210/Discussion Room', room: 'E2-03-08-DR210', type: 'Discussion Room', capacity: 8 },
    { name: 'E2-03-19-DR215/Discussion Room', room: 'E2-03-19-DR215', type: 'Discussion Room', capacity: 8 },
    { name: 'E2-03-20-DR216/Discussion Room', room: 'E2-03-20-DR216', type: 'Discussion Room', capacity: 8 },
  ]);

  // Capacities are integers and no name carries "Capacity:".
  for (const r of rooms) {
    assert.equal(Number.isInteger(r.capacity), true, `${r.name} capacity is integer`);
    assert.equal(/Capacity:/i.test(r.name), false, `name "${r.name}" has no Capacity:`);
  }
});

test('card parser pairs each resourceName with the capacity that follows it', () => {
  const html = `
    <div class="card-body"><div class="resourceName">AAA-1/Seminar Room</div>
      <div><i></i> Capacity: 25</div></div>
    <div class="card-body"><div class="resourceName">BBB-2/Seminar Room</div>
      <div><i></i> Capacity: 40</div></div>
  `;
  const rooms = parseResults(html);
  assert.deepEqual(
    rooms.map((r) => [r.room, r.type, r.capacity]),
    [
      ['AAA-1', 'Seminar Room', 25],
      ['BBB-2', 'Seminar Room', 40],
    ]
  );
});

test('duplicate cards for the same room collapse to one room (dedupe by room code)', () => {
  const html = `
    <div class="card-body"><div class="resourceName">LT-1A/Lecture Theatre</div>
      <div> Capacity: 120</div></div>
    <div class="card-body"><div class="resourceName">LT-1A/Lecture Theatre</div>
      <div> Capacity: 120</div></div>
  `;
  const rooms = parseResults(html);
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].room, 'LT-1A');
  assert.equal(rooms[0].type, 'Lecture Theatre');
  assert.equal(rooms[0].capacity, 120);
});

test('inline text/table-row shape still works as a fallback', () => {
  // No cards present -> fall back to inline "NAME/TYPE Capacity: N" rows.
  const html = `
    <table>
      <tr><td><span>SR-03-07/Seminar Room Capacity: 40 Seminar Room A</span></td></tr>
    </table>
  `;
  const rooms = parseResults(html);
  assert.equal(rooms.length, 1);
  assert.deepEqual(rooms[0], {
    name: 'SR-03-07/Seminar Room',
    room: 'SR-03-07',
    type: 'Seminar Room',
    capacity: 40,
  });
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

test('filterAndSortRooms drops rooms below min capacity', () => {
  const rooms = parseResults(fixtureHtml); // 4 rooms, all capacity 8
  assert.equal(filterAndSortRooms(rooms, 10).length, 0);
  assert.equal(filterAndSortRooms(rooms, 8).length, 4);
});

test('filterAndSortRooms sorts by capacity descending, then room code', () => {
  const rooms = [
    { name: 'C-3/Room', room: 'C-3', type: 'Room', capacity: 10 },
    { name: 'A-1/Room', room: 'A-1', type: 'Room', capacity: 50 },
    { name: 'B-2/Room', room: 'B-2', type: 'Room', capacity: 10 },
  ];
  const sorted = filterAndSortRooms(rooms, 0);
  assert.deepEqual(
    sorted.map((r) => [r.room, r.capacity]),
    [
      ['A-1', 50],
      ['B-2', 10],
      ['C-3', 10],
    ]
  );
});
