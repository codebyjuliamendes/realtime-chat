/**
 * @fileoverview Token bucket rate limiter (one instance per connection).
 */

export class TokenBucket {
  /**
   * @param {{ capacity: number, refillPerSec: number, now?: () => number }} options
   */
  constructor({ capacity, refillPerSec, now = Date.now }) {
    this.capacity = capacity;
    this.refillPerMs = refillPerSec / 1000;
    this.now = now;
    this.tokens = capacity;
    this.updatedAt = now();
  }

  /**
   * Consumes `cost` tokens if available.
   * @param {number} [cost]
   * @returns {boolean} true when the action is allowed
   */
  tryRemove(cost = 1) {
    const now = this.now();
    const elapsed = Math.max(0, now - this.updatedAt);
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.updatedAt = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}
