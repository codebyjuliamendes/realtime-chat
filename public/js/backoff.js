/**
 * Exponential backoff with "full jitter": a random delay between `min` and
 * min(cap, base * 2^attempt). Jitter spreads reconnects so a server restart
 * does not get every client back at the same instant.
 * @param {number} attempt  0-based
 * @param {{ base?: number, cap?: number, min?: number, random?: () => number }} [opts]
 */
export function backoffDelay(attempt, { base = 1000, cap = 30_000, min = 500, random = Math.random } = {}) {
  const ceiling = Math.min(cap, base * 2 ** Math.max(0, attempt));
  return Math.round(min + random() * Math.max(0, ceiling - min));
}
