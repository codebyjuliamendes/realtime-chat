import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LRUCache } from '../../server/domain/lru-cache.js';

describe('LRUCache', () => {
  it('evicts the least recently used entry', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    assert.equal(cache.has('b'), false);
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.get('c'), 3);
  });
  it('returns null for missing keys and supports delete', () => {
    const cache = new LRUCache(1);
    assert.equal(cache.get('x'), null);
    cache.set('x', 1);
    assert.equal(cache.delete('x'), true);
    assert.equal(cache.has('x'), false);
  });
});
