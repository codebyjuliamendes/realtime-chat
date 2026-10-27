import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { backoffDelay } from '../../public/js/backoff.js';

describe('backoffDelay', () => {
  it('grows exponentially up to the cap', () => {
    const max = (attempt) => backoffDelay(attempt, { random: () => 1 });
    assert.equal(max(0), 1000);
    assert.equal(max(1), 2000);
    assert.equal(max(3), 8000);
    assert.equal(max(10), 30_000);
  });
  it('never goes below the minimum', () => {
    assert.equal(backoffDelay(5, { random: () => 0 }), 500);
  });
});
