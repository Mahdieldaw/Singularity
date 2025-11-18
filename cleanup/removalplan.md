## Immediate Rollback Assessment

Based on the failure patterns we're seeing, here's what to **keep, fix, or remove**:

---

## ⚠️ **FIX (Causing Current Issues)**

### #2 Error Boundaries - **PARTIAL ROLLBACK**
**What went wrong:**
```javascript
// V2 added onProviderComplete - causing race conditions
onProviderComplete: (providerId, data) => {
  this.port.postMessage({
    type: "WORKFLOW_STEP_UPDATE",
    status: "completed" // ❌ Claims completion before onAllComplete
  });
}
```

**Fix (don't rollback completely):**
```javascript
// Keep the error handling improvements from #2
onError: (error) => {
  this.port.postMessage({ 
    type: "WORKFLOW_STEP_UPDATE", 
    status: "failed", 
    error: error.message 
  });
  reject(error);
}

// ❌ REMOVE onProviderComplete entirely
// Only emit updates in onAllComplete
```

**Keep:** `onError` callback, error propagation logic  
**Remove:** `onProviderComplete` callback

---

### #3 Memory Management - **PARTIAL ROLLBACK**

**StreamingBuffer (Document 3) - What went wrong:**
```javascript
// NEW CODE causing problems:
private readonly FLUSH_MIN_INTERVAL_MS = 100; // ❌ Throttle too aggressive
private deferredTimeout: number | null = null; // ❌ Creates setTimeout queue
```

**Fix (targeted rollback):**
```typescript
// REMOVE these properties:
- private readonly FLUSH_MIN_INTERVAL_MS = 100;
- private deferredTimeout: number | null = null;
- private lastFlushAt: number = 0;

// KEEP these improvements:
+ private readonly MAX_CHUNKS_PER_PROVIDER = 500; // ✅ Good safeguard
+ private chunkCounts: Map<string, number> = new Map();
+ getMemoryStats() // ✅ Useful for debugging

// Revert scheduleBatchFlush to original double-RAF only:
private scheduleBatchFlush() {
  if (this.flushTimer !== null) return; // ✅ Keep
  
  // ✅ ONLY use double-RAF pattern (original)
  this.flushTimer = window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      this.flushAll();
      this.flushTimer = null;
    });
  });
}
```

**Keep:** MAX_CHUNKS safeguard, memory stats, chunk counting  
**Remove:** 100ms throttle, deferredTimeout, lastFlushAt tracking

---

### #7 Circuit Breaker (Document 4) - **NEEDS CONFIGURATION**

**Not inherently broken, but needs tuning:**

```javascript
// Current values too aggressive for Claude's slow streaming:
this.failureThreshold = options.failureThreshold || 5; // ✅ Fine
this.resetTimeout = options.resetTimeout || 60000;     // ❌ Too short

// Claude's 183s stream exceeded this, triggering circuit open
```

**Fix (tune parameters):**
```javascript
export class CircuitBreaker {
  constructor(options = {}) {
    this.state = "CLOSED";
    this.failures = 0;
    this.lastFailure = 0;
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 300000; // ✅ 5min instead of 1min
    
    // ✅ Add timeout per provider
    this.providerTimeouts = {
      claude: 600000,   // 10min for Claude's slow streams
      chatgpt: 120000,  // 2min
      gemini: 120000,
      default: 120000
    };
  }
  
  async execute(action, providerId = 'default') {
    const timeout = this.providerTimeouts[providerId] || this.providerTimeouts.default;
    
    // ✅ Don't fail circuit just because stream is slow
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Provider timeout')), timeout)
    );
    
    try {
      const result = await Promise.race([action(), timeoutPromise]);
      this.recordSuccess();
      return result;
    } catch (err) {
      // ✅ Only record failure if it's NOT a timeout during active streaming
      if (err.message !== 'Provider timeout' || this.state !== 'CLOSED') {
        this.recordFailure();
      }
      throw err;
    }
  }
}
```

**Keep circuit breaker, but:**
- Increase `resetTimeout` to 5min
- Add per-provider timeout configs
- Don't trip circuit on slow but active streams

---

### #8 Rate Limiter (Document 5) - **CAUSING BATCH DELAYS**

**What went wrong:**
```javascript
// workflow-engine.js V2 - WRONG LOCATION
async executePromptStep(step, context) {
  try {
    const mod = await import("./RateLimiter.js");
    for (const pid of providers) await mod.rateLimiter.acquire(pid);
  } catch (_) {}
  
  return new Promise((resolve, reject) => {
    // ❌ Rate limit happens INSIDE executePromptStep
    // If tokens depleted, entire batch step blocks
  });
}
```

**Fix (move rate limiting to provider level):**

```javascript
// ❌ REMOVE from executePromptStep entirely

// ✅ ADD to provider adapters instead:
// providers/ClaudeProvider.js
import { rateLimiter } from './RateLimiter.js';

async ask(messages, options) {
  await rateLimiter.acquire('claude'); // ✅ Acquire per-provider
  
  const response = await this._fetchAuth(...);
  // ... rest of implementation
}
```

**Why this fixes it:**
- Rate limiting happens **per provider** instead of blocking entire batch
- Qwen finishing early doesn't block Claude from acquiring tokens
- Each provider manages its own token bucket independently

**Rollback decision:**  
**Keep RateLimiter class, but remove from `executePromptStep`**  
**Move to individual provider `ask()` methods**

---

## 🔥 **REMOVE COMPLETELY**

### #1 Service Worker Bootloader - **IF YOU ADDED EAGER LOADING**

**If you added this:**
```javascript
// sw-entry.js - EAGER IIFE
(async () => {
  await NetRulesManager.init();
  await ArkoseController.init();
  const services = await initializeGlobalServices();
  await resumeInflightWorkflows(services);
})();
```

**Remove it temporarily** because:
- Eager loading can delay listener attachment
- Causes the "extension dead on startup" issue
- Your current setup likely already works (listeners attach first)

**Rollback to:**
```javascript
// ✅ Attach listeners FIRST (synchronously)
chrome.runtime.onConnect.addListener(async (port) => {
  const services = await initializeGlobalServices(); // Lazy
  const handler = new ConnectionHandler(port, services);
});

// ✅ Defer non-critical startup work
chrome.runtime.onStartup.addListener(async () => {
  // Only run after listeners are ready
  await NetRulesManager.init();
});
```

---

### #4 Persistence SSOT - **IF YOU CHANGED IMPORTS**

**If you changed this:**
```javascript
// persistence/index.ts - BEFORE
export { createSessionManager } from './SessionManager.js';

// persistence/index.ts - AFTER (WRONG)
export const createSessionManager = async () => {
  const mod = await import('./SessionManager.js');
  return mod.createSessionManager();
};
```

**Rollback to synchronous export:**
```javascript
// ✅ Direct export (original)
export { createSessionManager } from './SessionManager.js';
```

Dynamic imports in exports cause `TypeError: createSessionManager is not a function`.

---

## 📋 Concrete Action Plan

### Phase 1: Immediate Rollbacks (30 minutes)

```bash
# 1. Revert StreamingBuffer throttle
git diff src/ui/utils/streamingBuffer.ts
# Remove: FLUSH_MIN_INTERVAL_MS, deferredTimeout, lastFlushAt
# Keep: MAX_CHUNKS_PER_PROVIDER, chunkCounts, getMemoryStats()

# 2. Remove onProviderComplete from workflow-engine
git diff src/core/workflow-engine.js
# Remove: onProviderComplete callback in executePromptStep
# Keep: onError callback

# 3. Remove rate limiter from executePromptStep
git diff src/core/workflow-engine.js
# Remove: try { const mod = await import("./RateLimiter.js"); ... }
# Add: Per-provider rate limiting in ClaudeProvider.ask(), etc.

# 4. Check sw-entry.js
git diff src/background/sw-entry.js
# Remove: Any eager IIFE before listener attachment
# Keep: Lazy initialization inside handlers
```

### Phase 2: Apply Targeted Fixes (1 hour)

**Fix 1: Normalize Delta Cache Keys**
```javascript
// workflow-engine.js - makeDelta
function makeDelta(sessionId, providerId, fullText = "", label = "") {
  if (!sessionId) return fullText || "";
  
  // ✅ Add normalization
  const normalizedLabel = String(label || "default").toLowerCase();
  const key = `${sessionId}:${normalizedLabel}:${providerId}`;
  
  const prev = lastStreamState.get(key) || "";
  // ... rest unchanged
}

// ✅ Update all _dispatchPartialDelta calls
_dispatchPartialDelta(sessionId, stepId, providerId, text, "batch"); // Consistent
```

**Fix 2: Move clearDeltaCache to End of Workflow**
```javascript
// workflow-engine.js - execute()
async execute(request, resolvedContext) {
  try {
    // ... all workflow steps ...
    
    // ✅ Flush before clearing
    if (this._streamingBuffer) {
      this._streamingBuffer.flushImmediate();
    }
    
    // Emit WORKFLOW_COMPLETE
    this.port.postMessage({ type: "WORKFLOW_COMPLETE", ... });
    
    // Emit TURN_FINALIZED
    this._emitTurnFinalized(context, steps, stepResults);
    
  } catch (error) {
    console.error("[WorkflowEngine] Critical error:", error);
  } finally {
    // ✅ Always clear cache at the very end
    clearDeltaCache(context.sessionId);
  }
}
```

**Fix 3: Tune Circuit Breaker**
```javascript
// CircuitBreaker.js
constructor(options = {}) {
  this.state = "CLOSED";
  this.failures = 0;
  this.lastFailure = 0;
  this.failureThreshold = options.failureThreshold || 5;
  this.resetTimeout = options.resetTimeout || 300000; // ✅ 5min
}
```

### Phase 3: Test Validation (30 minutes)

```bash
# Test 1: Verify batch completes without premature updates
# Expected: Single WORKFLOW_STEP_UPDATE after all providers complete

# Test 2: Verify synthesis receives non-empty sources
# Expected: No "returned empty response" errors

# Test 3: Verify long Claude streams don't abort
# Expected: 183s streams complete successfully

# Test 4: Monitor console for delta cache warnings
# Expected: No "Significant text regression" warnings
```

---

## Summary: What to Keep vs Remove

| Component | Action | Reason |
|-----------|--------|--------|
| Session Registry | ✅ Keep | Not causing issues |
| Circuit Breaker | 🔧 Keep + tune timeouts | Good architecture, needs config |
| Rate Limiter | 🔄 Keep + move to providers | Wrong location, not wrong concept |
| StreamingBuffer MAX_CHUNKS | ✅ Keep | Good safeguard |
| StreamingBuffer 100ms throttle | ❌ Remove | Causes UI freezes |
| onProviderComplete | ❌ Remove | Race conditions |
| onError callback | ✅ Keep | Proper error handling |
| Delta cache normalization | 🔧 Add fix | Missing in both versions |
| Eager SW bootloader | ❌ Remove if added | Delays listener attachment |
| Persistence dynamic imports | ❌ Rollback if changed | Causes type errors |

**Bottom line:** You don't need to nuke everything. **~70% of your work is solid**. The issues are from **3 specific interactions**:

1. `onProviderComplete` racing with `onAllComplete`
2. StreamingBuffer throttle blocking long streams
3. Rate limiter in wrong location (batch level vs provider level)

Fix those 3, and your architecture improvements will work as intended.