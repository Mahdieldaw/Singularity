class WorkflowSession {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.resources = [];
    this.abortControllers = new Map();
    this.timers = [];
    this.rafIds = [];
  }
  addResource(resource, type) {
    this.resources.push({ resource, type, addedAt: Date.now() });
  }
  addAbortController(key, controller) {
    this.abortControllers.set(key, controller);
  }
  addTimer(timerId) {
    this.timers.push(timerId);
  }
  addRAF(rafId) {
    this.rafIds.push(rafId);
  }
  dispose() {
    this.abortControllers.forEach((controller) => {
      try {
        controller.abort();
      } catch {}
    });
    this.abortControllers.clear();
    this.timers.forEach((id) => {
      try {
        clearTimeout(id);
      } catch {}
    });
    this.timers.length = 0;
    this.rafIds.forEach((id) => {
      try {
        cancelAnimationFrame(id);
      } catch {}
    });
    this.rafIds.length = 0;
    this.resources.forEach(({ resource, type }) => {
      try {
        if (type === "buffer" && resource?.clear) resource.clear();
        else if (type === "port" && resource?.disconnect) resource.disconnect();
        else if (type === "idb" && resource?.close) resource.close();
      } catch {}
    });
    this.resources.length = 0;
  }
}

class SessionRegistry {
  constructor() {
    this.sessions = new Map();
    this.maxSessions = 50;
    this.cleanupInterval = null;
    this.startPeriodicCleanup();
  }
  register(sessionId) {
    if (this.sessions.has(sessionId)) return this.sessions.get(sessionId);
    if (this.sessions.size >= this.maxSessions) this.cleanupOldest();
    const s = new WorkflowSession(sessionId);
    this.sessions.set(sessionId, s);
    return s;
  }
  get(sessionId) {
    return this.sessions.get(sessionId);
  }
  unregister(sessionId) {
    const s = this.sessions.get(sessionId);
    if (s) {
      s.dispose();
      this.sessions.delete(sessionId);
    }
  }
  cleanupOldest() {
    let oldestId = null;
    let oldestTs = Date.now();
    this.sessions.forEach((s, id) => {
      const ts = s.resources[0]?.addedAt || 0;
      if (ts < oldestTs) {
        oldestTs = ts;
        oldestId = id;
      }
    });
    if (oldestId) this.unregister(oldestId);
  }
  startPeriodicCleanup() {
    if (this.cleanupInterval) return;
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const THRESHOLD = 30 * 60 * 1000;
      const toClean = [];
      this.sessions.forEach((s, id) => {
        const last = s.resources[s.resources.length - 1]?.addedAt || 0;
        if (now - last > THRESHOLD) toClean.push(id);
      });
      toClean.forEach((id) => this.unregister(id));
    }, 5 * 60 * 1000);
  }
  stopPeriodicCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
  getMemoryStats() {
    let totalResources = 0;
    let totalAbortControllers = 0;
    this.sessions.forEach((s) => {
      totalResources += s.resources.length;
      totalAbortControllers += s.abortControllers.size;
    });
    return {
      activeSessions: this.sessions.size,
      totalResources,
      totalAbortControllers,
    };
  }
}

export const sessionRegistry = new SessionRegistry();
if (typeof globalThis !== "undefined") {
  globalThis.__HTOS_SESSION_REGISTRY = sessionRegistry;
}