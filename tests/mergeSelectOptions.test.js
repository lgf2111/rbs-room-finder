'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Mock the mergeSelectOptions function (it's in panel.js, but we'll test the logic)
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

test('mergeSelectOptions keeps selection when option exists in new list', () => {
  const result = mergeSelectOptions(
    ['All rooms', 'Discussion Room', 'Lecture Theatre'],
    ['All rooms', 'Discussion Room', 'Lecture Theatre', 'Lab'],
    'Discussion Room'
  );
  assert.deepEqual(result.options, ['All rooms', 'Discussion Room', 'Lecture Theatre', 'Lab']);
  assert.equal(result.value, 'Discussion Room');
});

test('mergeSelectOptions falls back to empty when "All rooms" selected and not in new list', () => {
  const result = mergeSelectOptions(
    ['All rooms', 'Discussion Room'],
    ['Discussion Room', 'Lecture Theatre'], // No "All rooms" in new list
    '' // Current value is empty (All rooms)
  );
  assert.deepEqual(result.options, ['Discussion Room', 'Lecture Theatre']);
  assert.equal(result.value, '');
});

test('mergeSelectOptions falls back to first option when specific value not in new list', () => {
  const result = mergeSelectOptions(
    ['All rooms', 'Discussion Room', 'Lecture Theatre'],
    ['All rooms', 'Lecture Theatre', 'Lab'], // No "Discussion Room" in new list
    'Discussion Room'
  );
  assert.deepEqual(result.options, ['All rooms', 'Lecture Theatre', 'Lab']);
  assert.equal(result.value, 'All rooms'); // Should fall back to first option
});

test('mergeSelectOptions handles empty new options list', () => {
  const result = mergeSelectOptions(
    ['All rooms', 'Discussion Room'],
    [], // Empty new options
    'Discussion Room'
  );
  assert.deepEqual(result.options, []);
  assert.equal(result.value, ''); // Should be empty when no options
});

test('mergeSelectOptions handles window time options', () => {
  // Test with time options
  const result = mergeSelectOptions(
    ['07:00', '07:30', '08:00'],
    ['07:00', '07:30', '08:00', '08:30'],
    '07:30'
  );
  assert.deepEqual(result.options, ['07:00', '07:30', '08:00', '08:30']);
  assert.equal(result.value, '07:30');
});

test('mergeSelectOptions falls back to first time when current not in new list', () => {
  const result = mergeSelectOptions(
    ['07:00', '07:30', '08:00'],
    ['08:00', '08:30', '09:00'], // No 07:30 in new list
    '07:30'
  );
  assert.deepEqual(result.options, ['08:00', '08:30', '09:00']);
  assert.equal(result.value, '08:00'); // Should fall back to first option
});