// ============================================================================
// MEMORY MANAGEMENT IMPROVEMENTS
// Prevents memory leaks in streaming and workflow sessions
// ============================================================================

// === ENHANCED STREAMING BUFFER WITH LIMITS ===
class StreamingBuffer {
  constructor(onFlush) {
    this.pendingDeltas = new Map();
    this.flushTimer = null;
    this.onFlushCallback = onFlush;
    
    // ✅ NEW: Configuration limits
    this.MAX_CHUNKS_PER_PROVIDER = 500; // Max buffered chunks before forced flush
    this.FLUSH_INTERVAL_MS = 16; // ~60fps
    this.chunkCounts = new Map(); // Track chunk count per provider
  }

  addDelta(providerId, delta, status, responseType) {
    const key = `${responseType}:${providerId}`;
    
    if (!this.pendingDeltas.has(key)) {
      this.pendingDeltas.set(key, {
        deltas: [],
        status,
        responseType,
      });
      this.chunkCounts.set(key, 0);
    }

    const entry = this.pendingDeltas.get(key);
    entry.deltas.push({ text: delta, ts: Date.now() });
    entry.status = status;
    entry.responseType = responseType;
    
    // ✅ Increment chunk count
    const count = this.chunkCounts.get(key) + 1;
    this.chunkCounts.set(key, count);
    
    // ✅ CRITICAL: Force flush if we exceed max chunks
    if (count >= this.MAX_CHUNKS_PER_PROVIDER) {
      console.warn(
        `[StreamingBuffer] Max chunks reached for ${key}, forcing flush`
      );
      this.flushImmediate();
      return;
    }

    this.scheduleBatchFlush();
  }

  scheduleBatchFlush() {
    if (this.flushTimer !== null) {
      cancelAnimationFrame(this.flushTimer);
    }

    // ✅ Double-RAF pattern for smooth rendering
    this.flushTimer = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        this.flushAll();
        this.flushTimer = null;
      });
    });
  }

  flushAll() {
    const updates = [];

    this.pendingDeltas.forEach((entry, compositeKey) => {
      const idx = compositeKey.indexOf(":");
      const providerId = idx >= 0 ? compositeKey.slice(idx + 1) : compositeKey;
      
      // ✅ Join deltas and clear immediately
      const concatenatedText = entry.deltas.map((d) => d.text).join("");
      const lastTs = entry.deltas.length
        ? entry.deltas[entry.deltas.length - 1].ts
        : Date.now();
      
      updates.push({
        providerId,
        text: concatenatedText,
        status: entry.status,
        responseType: entry.responseType,
        createdAt: lastTs,
      });
      
      // ✅ Clear deltas array to free memory
      entry.deltas.length = 0;
    });

    // ✅ Clear all pending data
    this.pendingDeltas.clear();
    this.chunkCounts.clear();

    if (updates.length > 0) {
      updates.sort((a, b) => a.createdAt - b.createdAt);
      this.onFlushCallback(updates);
    }
  }

  flushImmediate() {
    if (this.flushTimer !== null) {
      cancelAnimationFrame(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushAll();
  }

  clear() {
    if (this.flushTimer !== null) {
      cancelAnimationFrame(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingDeltas.clear();
    this.chunkCounts.clear();
  }
  
  // ✅ NEW: Get memory usage stats for monitoring
  getMemoryStats() {
    let totalChunks = 0;
    let totalBytes = 0;
    
    this.pendingDeltas.forEach((entry) => {
      totalChunks += entry.deltas.length;
      entry.deltas.forEach(d => {
        totalBytes += (d.text?.length || 0) * 2; // Rough estimate: 2 bytes per char
      });
    });
    
    return {
      providers: this.pendingDeltas.size,
      totalChunks,
      totalBytes,
      estimatedMB: (totalBytes / 1024 / 1024).toFixed(2),
    };
  }
}

// ============================================================================
// WORKFLOW SESSION WITH RESOURCE CLEANUP
// ============================================================================

class WorkflowSession {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.resources = [];
    this.abortControllers = new Map();
    this.timers = [];
    this.rafIds = [];
    
    // ✅ NEW: Track for automatic cleanup
    if (typeof FinalizationRegistry !== 'undefined') {
      this.registry = new FinalizationRegistry((sessionId) => {
        console.log(`[Memory] Auto-cleanup triggered for ${sessionId}`);
      });
      this.registry.register(this, this.sessionId);
    }
  }
  
  // ✅ Register a resource for cleanup
  addResource(resource, type) {
    this.resources.push({ resource, type, addedAt: Date.now() });
  }
  
  // ✅ Add abort controller
  addAbortController(key, controller) {
    this.abortControllers.set(key, controller);
  }
  
  // ✅ Add timer
  addTimer(timerId) {
    this.timers.push(timerId);
  }
  
  // ✅ Add RAF ID
  addRAF(rafId) {
    this.rafIds.push(rafId);
  }
  
  // ✅ Dispose all resources
  dispose() {
    console.log(`[Memory] Disposing workflow session ${this.sessionId}`);
    
    // Abort all pending requests
    this.abortControllers.forEach((controller, key) => {
      try {
        console.log(`[Memory] Aborting request: ${key}`);
        controller.abort();
      } catch (e) {
        console.warn(`[Memory] Failed to abort ${key}:`, e);
      }
    });
    this.abortControllers.clear();
    
    // Clear timers
    this.timers.forEach((timerId) => {
      try {
        clearTimeout(timerId);
      } catch (e) {}
    });
    this.timers.length = 0;
    
    // Cancel RAF callbacks
    this.rafIds.forEach((rafId) => {
      try {
        cancelAnimationFrame(rafId);
      } catch (e) {}
    });
    this.rafIds.length = 0;
    
    // Clean up custom resources
    this.resources.forEach(({ resource, type }) => {
      try {
        if (type === 'port' && resource.disconnect) {
          resource.disconnect();
        } else if (type === 'buffer' && resource.clear) {
          resource.clear();
        } else if (type === 'idb' && resource.close) {
          resource.close();
        }
      } catch (e) {
        console.warn(`[Memory] Failed to cleanup ${type}:`, e);
      }
    });
    this.resources.length = 0;
    
    console.log(`[Memory] ✅ Session ${this.sessionId} disposed`);
  }
}

// ============================================================================
// SESSION REGISTRY (tracks all active sessions)
// ============================================================================

class SessionRegistry {
  constructor() {
    this.sessions = new Map();
    this.maxSessions = 50; // Limit concurrent sessions
    this.cleanupInterval = null;
    
    // Start periodic cleanup
    this.startPeriodicCleanup();
  }
  
  register(sessionId) {
    if (this.sessions.has(sessionId)) {
      console.warn(`[Memory] Session ${sessionId} already registered`);
      return this.sessions.get(sessionId);
    }
    
    // ✅ Check if we're at capacity
    if (this.sessions.size >= this.maxSessions) {
      console.warn(`[Memory] Max sessions reached (${this.maxSessions}), cleaning up oldest`);
      this.cleanupOldest();
    }
    
    const session = new WorkflowSession(sessionId);
    this.sessions.set(sessionId, session);
    console.log(`[Memory] Registered session ${sessionId} (total: ${this.sessions.size})`);
    
    return session;
  }
  
  get(sessionId) {
    return this.sessions.get(sessionId);
  }
  
  unregister(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.dispose();
      this.sessions.delete(sessionId);
      console.log(`[Memory] Unregistered session ${sessionId} (remaining: ${this.sessions.size})`);
    }
  }
  
  cleanupOldest() {
    // Find oldest session by creation time
    let oldest = null;
    let oldestTime = Date.now();
    
    this.sessions.forEach((session, sessionId) => {
      const firstResource = session.resources[0];
      const addedAt = firstResource?.addedAt || 0;
      if (addedAt < oldestTime) {
        oldestTime = addedAt;
        oldest = sessionId;
      }
    });
    
    if (oldest) {
      console.log(`[Memory] Cleaning up oldest session: ${oldest}`);
      this.unregister(oldest);
    }
  }
  
  startPeriodicCleanup() {
    // Clean up every 5 minutes
    this.cleanupInterval = setInterval(() => {
      console.log(`[Memory] Periodic cleanup check (${this.sessions.size} sessions)`);
      
      // Check for abandoned sessions (no activity in 30 minutes)
      const now = Date.now();
      const ABANDONED_THRESHOLD = 30 * 60 * 1000; // 30 minutes
      
      const toCleanup = [];
      this.sessions.forEach((session, sessionId) => {
        const lastActivity = session.resources[session.resources.length - 1]?.addedAt || 0;
        if (now - lastActivity > ABANDONED_THRESHOLD) {
          toCleanup.push(sessionId);
        }
      });
      
      if (toCleanup.length > 0) {
        console.log(`[Memory] Cleaning up ${toCleanup.length} abandoned sessions`);
        toCleanup.forEach(sessionId => this.unregister(sessionId));
      }
    }, 5 * 60 * 1000); // 5 minutes
  }
  
  stopPeriodicCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
  
  // ✅ Get memory stats for all sessions
  getMemoryStats() {
    let totalResources = 0;
    let totalAbortControllers = 0;
    
    this.sessions.forEach((session) => {
      totalResources += session.resources.length;
      totalAbortControllers += session.abortControllers.size;
    });
    
    return {
      activeSessions: this.sessions.size,
      totalResources,
      totalAbortControllers,
    };
  }
}

// ============================================================================
// GLOBAL REGISTRY INSTANCE
// ============================================================================

const sessionRegistry = new SessionRegistry();

// Expose for debugging
if (typeof globalThis !== 'undefined') {
  globalThis.__HTOS_SESSION_REGISTRY = sessionRegistry;
}

// ============================================================================
// USAGE IN WORKFLOW ENGINE
// ============================================================================

// In WorkflowEngine.execute():
async execute(request, resolvedContext) {
  const { context, steps } = request;
  const sessionId = context.sessionId;
  
  // ✅ Register session for resource tracking
  const session = sessionRegistry.register(sessionId);
  
  try {
    // Add streaming buffer as a tracked resource
    const buffer = new StreamingBuffer((updates) => {
      // ... handle updates
    });
    session.addResource(buffer, 'buffer');
    
    // Track abort controllers
    this.orchestrator.activeRequests.forEach((request, key) => {
      request.abortControllers.forEach((controller, providerId) => {
        session.addAbortController(`${key}:${providerId}`, controller);
      });
    });
    
    // ... rest of workflow execution
    
  } catch (error) {
    console.error('[WorkflowEngine] Error:', error);
    throw error;
  } finally {
    // ✅ CRITICAL: Always cleanup when workflow completes
    console.log(`[Memory] Cleaning up workflow session ${sessionId}`);
    sessionRegistry.unregister(sessionId);
    
    // Also clear delta cache
    clearDeltaCache(sessionId);
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { StreamingBuffer, WorkflowSession, SessionRegistry, sessionRegistry };
