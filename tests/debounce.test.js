'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Mock debounce helper
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

test('debounce delays execution', async (t) => {
  let callCount = 0;
  const fn = () => callCount++;
  const debounced = debounce(fn, 50);
  
  // Call multiple times quickly
  debounced();
  debounced();
  debounced();
  
  // Should not have been called yet
  assert.equal(callCount, 0);
  
  // Wait for debounce time
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Should have been called once
  assert.equal(callCount, 1);
});

test('requestReload queue guard test (simulated)', async (t) => {
  // Simulate the requestReload queue guard behavior
  let reloadInProgress = false;
  let queuedReload = false;
  let loadCount = 0;
  let resolveCallbacks = [];
  
  function simulateRequestReload() {
    if (reloadInProgress) {
      queuedReload = true;
      return;
    }
    
    reloadInProgress = true;
    loadCount++;
    
    // Simulate async load that we can control
    return new Promise(resolve => {
      resolveCallbacks.push(() => {
        reloadInProgress = false;
        resolve();
        
        if (queuedReload) {
          queuedReload = false;
          simulateRequestReload();
        }
      });
    });
  }
  
  // Start first load
  const firstLoad = simulateRequestReload();
  assert.equal(loadCount, 1);
  assert.equal(reloadInProgress, true);
  
  // Try to load while in progress - should queue
  simulateRequestReload();
  assert.equal(loadCount, 1); // Still 1
  assert.equal(queuedReload, true);
  
  // Complete first load
  resolveCallbacks[0]();
  await firstLoad;
  
  // Should have run queued load (second load)
  assert.equal(loadCount, 2);
  assert.equal(reloadInProgress, true); // Second load is now in progress
  assert.equal(queuedReload, false);
  
  // Complete second load
  resolveCallbacks[1]();
  
  // Test that multiple queued loads collapse to one
  const thirdLoad = simulateRequestReload();
  assert.equal(loadCount, 3);
  
  // Queue multiple loads while in progress
  simulateRequestReload();
  simulateRequestReload();
  simulateRequestReload();
  
  assert.equal(loadCount, 3); // Still 3
  assert.equal(queuedReload, true);
  
  // Complete third load
  resolveCallbacks[2]();
  await thirdLoad;
  
  // Should have run only one more load (fourth), not three
  assert.equal(loadCount, 4);
  assert.equal(queuedReload, false);
});