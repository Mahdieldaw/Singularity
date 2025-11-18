export class CircuitBreaker {
  constructor(options = {}) {
    this.state = "CLOSED";
    this.failures = 0;
    this.lastFailure = 0;
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000;
  }
  async execute(action) {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailure > this.resetTimeout) {
        this.state = "HALF_OPEN";
      } else {
        throw new Error("CircuitBreaker OPEN");
      }
    }
    try {
      const result = await action();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }
  recordSuccess() {
    this.failures = 0;
    if (this.state === "HALF_OPEN") this.state = "CLOSED";
  }
  recordFailure() {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.state === "HALF_OPEN" || this.failures >= this.failureThreshold) {
      this.state = "OPEN";
    }
  }
}