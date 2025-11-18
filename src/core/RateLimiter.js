export class RateLimiter {
  constructor() {
    this.buckets = new Map();
    this.TOKENS_PER_SECOND = 5;
    this.MAX_TOKENS = 10;
  }
  async acquire(providerId) {
    let b = this.buckets.get(providerId);
    if (!b) {
      b = { tokens: this.MAX_TOKENS, lastRefill: Date.now() };
      this.buckets.set(providerId, b);
    }
    const now = Date.now();
    const elapsed = now - b.lastRefill;
    const add = (elapsed / 1000) * this.TOKENS_PER_SECOND;
    b.tokens = Math.min(this.MAX_TOKENS, b.tokens + add);
    b.lastRefill = now;
    if (b.tokens < 1) {
      const delay = (1 - b.tokens) * (1000 / this.TOKENS_PER_SECOND);
      await new Promise((r) => setTimeout(r, delay));
      return this.acquire(providerId);
    }
    b.tokens -= 1;
  }
}
export const rateLimiter = new RateLimiter();