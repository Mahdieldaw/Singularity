export class CircuitBreaker {
  constructor(options = {}) {
    this.state = "CLOSED";
    this.failures = 0;
    this.lastFailure = 0;
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 300000;
    this.providerTimeouts = {
      claude: 600000,
      chatgpt: 120000,
      gemini: 120000,
      default: 120000,
    };
  }
  async execute(action, providerId = "default") {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailure > this.resetTimeout) {
        this.state = "HALF_OPEN";
      } else {
        throw new Error("CircuitBreaker OPEN");
      }
    }
    const timeout = this.providerTimeouts[providerId] || this.providerTimeouts.default;
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Provider timeout")), timeout),
    );
    try {
      const result = await Promise.race([action(), timeoutPromise]);
      this.recordSuccess();
      return result;
    } catch (err) {
      if (err.message !== "Provider timeout" || this.state !== "CLOSED") {
        this.recordFailure();
      }
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