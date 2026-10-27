import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TokenBucket } from '../../server/domain/rate-limiter.js';

describe('TokenBucket', () => {
  it('allows a burst then refills over time', () => {
    let now = 0;
    const bucket = new TokenBucket({ capacity: 3, refillPerSec: 2, now: () => now });
    assert.equal(bucket.tryRemove(), true);
    assert.equal(bucket.tryRemove(), true);
    assert.equal(bucket.tryRemove(), true);
    assert.equal(bucket.tryRemove(), false);
    now += 500; // +1 token
    assert.equal(bucket.tryRemove(), true);
    assert.equal(bucket.tryRemove(), false);
    now += 10_000; // never above capacity
    assert.equal(bucket.tryRemove(3), true);
    assert.equal(bucket.tryRemove(), false);
  });
});
