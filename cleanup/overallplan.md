# Singularity Technical Debt: Consolidated Action Plan

## 🎯 Critical Path (Week 1-2: Survival & Stability)

### 1. **Service Worker Bootloader** ⚠️ HIGHEST PRIORITY
**Problem:** SW may terminate before listeners attach on slow machines; eager tasks (DNR, inflight resumption) must run at startup.

**Solution Hierarchy:**
- **Level 1 (Minimum):** Attach listeners synchronously, await services inside handlers
- **Level 2 (Robust):** Hybrid "Stall-and-Load" pattern with eager/lazy separation
  ```javascript
  // Top-level IIFE for EAGER tasks
  (async () => {
    await NetRulesManager.init();      // Must run before network requests
    await ArkoseController.init();
    const services = await initializeGlobalServices();
    await resumeInflightWorkflows(services); // Headless work
  })();
  
  // Listeners attached immediately
  chrome.runtime.onConnect.addListener(async (port) => {
    const services = await initializeGlobalServices(); // Awaits if needed
    const handler = new ConnectionHandler(port, services);
  });
  ```

**Impact:** Prevents extension being completely dead on user machines.

---

### 2. **Error Boundaries & Silent Failures** ⚠️ CRITICAL
**Problem:** Provider failures freeze UI forever; no error propagation.

**Solution Hierarchy:**
- **Level 1:** Add `onError` callbacks to orchestrator
  ```typescript
  orchestrator.executeParallelFanout(prompt, providers, {
    onAllComplete: (results) => resolve({ results }),
    onError: (error) => {
      port.postMessage({ type: 'WORKFLOW_STEP_UPDATE', status: 'failed', error: error.message });
      resolve({ results: {}, partial: true });
    }
  });
  ```
- **Level 2:** Standardize error types
  ```typescript
  class WorkflowError extends Error {
    constructor(message: string, public code: string, public recoverable: boolean = false) {}
  }
  ```
- **Level 3:** React error boundaries in `AiTurnBlock` to prevent one provider crash from killing UI

**Impact:** Graceful degradation instead of frozen loading spinners.

---

### 3. **Memory Management** ⚠️ CRITICAL
**Problem:** Streaming creates 10,000+ intermediate strings; no cleanup of abandoned resources.

**Solution Hierarchy:**
- **Level 1:** Batch streaming buffer with max limits
  ```typescript
  class StreamingBuffer {
    private buffer: string[] = [];
    private MAX_CHUNKS = 500;
    
    addDelta(delta: string) {
      this.buffer.push(delta);
      if (this.buffer.length >= this.MAX_CHUNKS) this.flush();
    }
    
    flush() {
      const fullText = this.buffer.join('');
      this.buffer = []; // Clear immediately
      this.updateState(fullText);
    }
  }
  ```
- **Level 2:** Add resource cleanup for workflows
  ```typescript
  class WorkflowSession {
    private cleanupCallbacks: (() => void)[] = [];
    dispose() {
      this.cleanupCallbacks.forEach(fn => fn());
      // Clean up ports, abort controllers, timers
    }
  }
  ```
- **Level 3:** Use `FinalizationRegistry` for automatic cleanup

**Impact:** Prevent 2GB memory leaks in long sessions.

---

## 🔧 High Priority (Week 2-3: Data Integrity & Observability)

### 4. **Persistence Layer - Single Source of Truth**
**Problem:** Multiple `SessionManager` instances create race conditions and potential DB corruption.

**Solution:**
```typescript
// sw-entry.js - SSOT for DB
let persistenceLayer, sessionManager; // Singleton instances

async function initializeGlobalServices() {
  if (globalServicesPromise) return globalServicesPromise;
  
  globalServicesPromise = (async () => {
    const adapter = new SimpleIndexedDBAdapter();
    await adapter.init();
    persistenceLayer = adapter;
    
    sessionManager = await createSessionManager(adapter); // Factory pattern
    // Inject into all consumers
    const compiler = new WorkflowCompiler(sessionManager);
    const resolver = new ContextResolver(sessionManager);
    
    return { sessionManager, compiler, resolver, persistenceLayer };
  })();
  
  return globalServicesPromise;
}
```

**Consolidate:** Remove dynamic imports in `persistence/index.ts` lines 63-65; export factory function directly.

**Impact:** Prevents `TypeError: createSessionManager is not a function` and IDBDatabase deadlocks.

---

### 5. **Data Migrations & Schema Versioning**
**Problem:** Updates corrupt old user data; no migration strategy.

**Solution:**
```typescript
const PERSISTENCE_VERSION = 2;

async function runMigrations(from: number, to: number) {
  if (from < 2) {
    // Add requestedFeatures to old AiTurnRecords
    const turns = await db.getAllFromIndex('turns', 'timestamp');
    for (const turn of turns) {
      if (turn.type === 'ai' && !turn.meta?.requestedFeatures) {
        turn.meta = {
          ...turn.meta,
          requestedFeatures: { synthesis: true, mapping: true },
          useThinking: turn.meta?.useThinking ?? false
        };
        await db.put('turns', turn);
      }
    }
  }
  await db.put('metadata', to, 'version');
}

// On startup
const storedVersion = await db.get('metadata', 'version') ?? 1;
if (storedVersion < PERSISTENCE_VERSION) {
  await runMigrations(storedVersion, PERSISTENCE_VERSION);
}
```

**Impact:** Seamless updates without data loss.

---

### 6. **Observability - Flight Recorder Logging**
**Problem:** Zero visibility when bugs occur in production; no debugging data.

**Solution:**
```typescript
class SystemLogger {
  private logs: Array<{ timestamp: number; level: string; event: string; data: any }> = [];
  private MAX_LOGS = 1000;
  
  log(level: 'info' | 'error' | 'warn', event: string, data: any) {
    this.logs.push({ timestamp: Date.now(), level, event, data: this.sanitize(data) });
    if (this.logs.length > this.MAX_LOGS) this.logs.shift();
    
    if (level === 'error') {
      console.error(`[${event}]`, data);
      // Optional: Send to error tracking service
    }
  }
  
  sanitize(data: any): any {
    return JSON.parse(JSON.stringify(data, (key, value) => {
      if (key === 'apiKey' || key === 'password' || /\d{3}-\d{2}-\d{4}/.test(value)) {
        return '[REDACTED]';
      }
      return value;
    }));
  }
  
  exportLogs() {
    return this.logs.slice(-100); // Last 100 events
  }
}

// Hook into critical operations
logger.log('info', 'WORKFLOW_STARTED', { stepId, providers });
logger.log('error', 'PROVIDER_FAILED', { providerId, error: error.message });
```

**Add UI:** "Export Debug Logs" button in settings.

**Impact:** Reproducible bug reports with exact failure traces.

---

## 🛡️ Medium Priority (Week 3-4: Resilience & Scale)

### 7. **Circuit Breakers for Providers**
**Problem:** Provider outages cause cascading failures; no retry logic.

**Solution:**
```typescript
class CircuitBreaker {
  private failures = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private readonly FAILURE_THRESHOLD = 5;
  private readonly RESET_TIMEOUT = 60000;
  private lastFailure = 0;
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailure > this.RESET_TIMEOUT) {
        this.state = 'HALF_OPEN';
      } else {
        throw new ProviderUnavailableError('Circuit breaker OPEN');
      }
    }
    
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }
  
  private recordFailure() {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.FAILURE_THRESHOLD) {
      this.state = 'OPEN';
    }
  }
  
  private recordSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }
}
```

**Impact:** Fail fast when providers are down; auto-recovery when they return.

---

### 8. **Rate Limiting**
**Problem:** 1000 concurrent users = 5000 API calls/sec = instant ban.

**Solution:**
```typescript
class RateLimiter {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();
  private readonly TOKENS_PER_SECOND = 10;
  
  async acquire(providerId: string): Promise<void> {
    let bucket = this.buckets.get(providerId);
    if (!bucket) {
      bucket = { tokens: this.TOKENS_PER_SECOND, lastRefill: Date.now() };
      this.buckets.set(providerId, bucket);
    }
    
    // Refill tokens
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(
      this.TOKENS_PER_SECOND,
      bucket.tokens + (elapsed / 1000) * this.TOKENS_PER_SECOND
    );
    bucket.lastRefill = now;
    
    if (bucket.tokens < 1) {
      await new Promise(r => setTimeout(r, 100));
      return this.acquire(providerId);
    }
    
    bucket.tokens -= 1;
  }
}

// Wrap provider calls
await rateLimiter.acquire('openai');
const response = await openaiAdapter.sendPrompt(...);
```

**Impact:** Stay under API limits; avoid account bans.

---

### 9. **Fault Isolation: Arkose/oi.js**
**Problem:** Arkose black box crashes kill entire offscreen doc (including localStorage proxy).

**Solution:**
- Create dedicated `ArkoseSolverService` in separate offscreen document
- Move localStorage proxy to its own offscreen doc
- Current: 1 offscreen doc = 2 unrelated responsibilities
- Target: 2 isolated offscreen docs with clear boundaries

**Impact:** Arkose failures don't cascade to core extension functionality.

---

## 🧹 Code Quality (Ongoing)

### 10. **TypeScript Migration**
**Priority Files:**
- `connection-handler.js` → `connection-handler.ts`
- `workflow-engine.js` → `workflow-engine.ts`

**Strategy:**
- Add runtime validation with Zod schemas
- Replace `any` with `unknown` + type guards
- Use exhaustive switch checks with `never`

### 11. **Dead Code Removal**
**Audit & Remove:**
- Deprecated `updateProviderContext` in `extension-api.ts`
- Legacy `SAVE_TURN` references (migrate to `persist('extend')`)
- Unused atoms: `pendingUserTurnsAtom` (verify usage first)
- Use ESLint `no-unused-vars` rule

**Impact:** 5-10% bundle size reduction; less cognitive load.

### 12. **State Management Simplification**
**Current:** Many individual Jotai atoms.
**Target:** Use `atomFamily` for per-turn state
```typescript
import { atomFamily } from 'jotai/utils';

const turnStateFamily = atomFamily((turnId: string) => 
  atom({ expanded: false, loading: false })
);

// Instead of: expandedUserTurnsAtom with Set<string>
// Use: turnStateFamily(turnId) for each turn
```

### 13. **UI Performance**
- Memoize `synthesisResponses` computation in `AiTurnBlock.tsx`
- Add `useMemo` for expensive array normalizations
- Tune Virtuoso's `increaseViewportBy` prop (test 200-300px)
- Limit streaming buffer flushes to every 100ms or 100 chunks

---

## 🤖 Development Experience

### 14. **Testing Infrastructure**
```json
{
  "scripts": {
    "test": "vitest",
    "test:watch": "vitest --watch",
    "test:coverage": "vitest --coverage",
    "test:e2e": "playwright test"
  }
}
```

**Start with:**
- Unit tests: `turn-helpers.ts`, `normalizeResponseArray`
- Integration tests: Mock providers, test full pipeline
- E2E tests: Critical flows (initialize → stream → finalize)

### 15. **Configuration Management**
**Problem:** Hardcoded timeouts/limits scattered everywhere.

**Solution:** Centralized config
```typescript
// config/providers.ts
export const ProviderConfig = {
  timeouts: { chatgpt: 30000, claude: 45000, gemini: 30000 },
  retries: { maxAttempts: 3, backoffMultiplier: 2 },
  circuitBreaker: { failureThreshold: 5, resetTimeout: 60000 }
} as const;
```

### 16. **CI/CD Quality Gates**
```yaml
# .github/workflows/quality-gate.yml
- run: npm run type-check
- run: npm run lint
- run: npm run test:coverage
- run: npm run build
- run: npm run bundle-size-check
```

### 17. **Performance Budgets**
```javascript
// .performance-budgets.js
module.exports = {
  'ui.js': '200KB',
  'bg.js': '150KB',
  'offscreen.js': '100KB',
  'startup-time-sw': '2s',
  'ui-initial-render': '1s'
};
```

---

## 📋 Quick Reference Priority Matrix

| Priority | Task | Impact | Effort | Risk if Skipped |
|----------|------|--------|--------|-----------------|
| P0 | SW Bootloader | 🔴 Critical | Medium | Extension DOA on slow machines |
| P0 | Error Boundaries | 🔴 Critical | Low | Frozen UI, user uninstalls |
| P0 | Memory Management | 🔴 Critical | Low | 2GB leaks, Chrome kills extension |
| P1 | Persistence SSOT | 🟠 High | Medium | Data corruption, DB deadlocks |
| P1 | Data Migrations | 🟠 High | Medium | Updates break user data |
| P1 | Observability | 🟠 High | Low | Can't debug production issues |
| P2 | Circuit Breakers | 🟡 Medium | Low | Provider outages cascade |
| P2 | Rate Limiting | 🟡 Medium | Low | API bans |
| P2 | Arkose Isolation | 🟡 Medium | Medium | Black box crashes kill core features |
| P3 | TypeScript Migration | 🟢 Low | High | Gradual; tackle incrementally |
| P3 | Testing | 🟢 Low | High | Confidence in refactors |

---

## 🚀 4-Week Execution Plan

**Week 1:** P0 survival fixes
- Day 1-2: SW Bootloader hybrid pattern
- Day 3: Error boundaries + onError callbacks
- Day 4-5: Streaming buffer memory limits

**Week 2:** P1 data integrity
- Day 1-2: Persistence SSOT refactor
- Day 3: Migration system implementation
- Day 4-5: Flight recorder logging + export UI

**Week 3:** P2 resilience
- Day 1-2: Circuit breakers per provider
- Day 3: Rate limiting
- Day 4-5: Arkose isolation architecture

**Week 4:** P3 polish
- Day 1-2: TypeScript migration (start with core files)
- Day 3-4: Testing setup + initial test suite
- Day 5: CI/CD pipeline

---

## 💡 Key Takeaways

1. **You've nailed the hard parts:** Immutable history, separation of concerns, stateful backend
2. **The gap is defensive engineering:** Error handling, resource cleanup, migrations
3. **Fix visibility first:** Can't improve what you can't measure (logging before optimization)
4. **Data safety is non-negotiable:** Migrations before new features
5. **Start small:** P0 fixes are 2-3 days of work but eliminate 80% of production risk

Your architecture is already better than most production systems. These changes add the seatbelts and airbags.