# Final Implementation Instructions

Execute these changes in order. Each instruction is complete and self-contained.

---

## 1. Remove Double RAF from StreamingBuffer

**File**: `src/ui/utils/streamingBuffer.ts`

**Task**: Change the `scheduleBatchFlush()` method to use single RAF instead of double RAF.

**Current code**:
```typescript
private scheduleBatchFlush() {
  if (this.flushTimer !== null) return;
  
  this.flushTimer = requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      this.flushAll();
      this.flushTimer = null;
    });
  });
}
```

**Change to**:
```typescript
private scheduleBatchFlush() {
  if (this.flushTimer !== null) return;
  
  this.flushTimer = requestAnimationFrame(() => {
    this.flushAll();
    this.flushTimer = null;
  });
}
```

**Explanation**: Remove the nested `requestAnimationFrame` call. This reduces latency from 32ms to 16ms.

---

## 2. Add Missing Constructor to StreamingBuffer

**File**: `src/ui/utils/streamingBuffer.ts`

**Task**: Add the constructor that was missing from the simplified version.

**Add this before the `addDelta` method**:
```typescript
constructor(onFlush: (updates: BatchUpdate[]) => void) {
  this.onFlushCallback = onFlush;
}

private onFlushCallback: (updates: BatchUpdate[]) => void;
```

**Explanation**: The StreamingBuffer needs to store the callback function passed during construction.

---

## 3. Re-apply SW Bootloader with Correct Order

**File**: `src/sw-entry.js`

**Task**: Ensure listeners are attached BEFORE any async initialization runs.

**Find the section where listeners are registered** (look for `chrome.runtime.onConnect.addListener` and `chrome.runtime.onMessage.addListener`).

**Ensure this order**:
```javascript
// 1. FIRST: Attach all listeners (synchronous, at top-level)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.$bus) return false;
  
  if (request?.type === 'htos.activity') {
    sendResponse({ success: true });
    return true;
  }
  
  if (request?.type === 'GET_HEALTH_STATUS') {
    try {
      const status = getHealthStatus();
      sendResponse({ success: true, status });
    } catch (e) {
      sendResponse({ success: false, error: e?.message });
    }
    return true;
  }
  
  if (request?.type) {
    (async () => {
      try {
        const services = await initializeGlobalServices();
        await handleUnifiedMessage(request, sender, sendResponse);
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
  
  return false;
});

chrome.runtime.onConnect.addListener(async (port) => {
  if (port.name !== "htos-popup") return;
  
  try {
    const services = await initializeGlobalServices();
    const handler = new ConnectionHandler(port, services);
    await handler.init();
  } catch (error) {
    console.error("[SW] Failed to initialize connection handler:", error);
    try {
      port.postMessage({ type: "INITIALIZATION_FAILED", error: error.message });
    } catch (_) {}
  }
});

// 2. THEN: Background initialization (doesn't block listeners)
(async () => {
  try {
    await NetRulesManager.init();
    await ArkoseController.init();
    const services = await initializeGlobalServices();
    await resumeInflightWorkflows(services);
  } catch (e) {
    console.error("[SW] Background initialization failed:", e);
  }
})();
```

**Explanation**: Listeners must be attached synchronously at the top level. The background IIFE runs in parallel without blocking listener attachment.

---

## 4. Re-apply Persistence SSOT with Correct Initialization Order

**File**: `src/sw-entry.js`

**Task**: Add singleton guards to persistence initialization and ensure correct order.

**At the top of the file** (after imports), add:
```javascript
let persistenceLayerSingleton = null;
let sessionManagerSingleton = null;
```

**Find `initializePersistence()` function and modify**:
```javascript
async function initializePersistence() {
  // Return existing singleton if already initialized
  if (persistenceLayerSingleton) {
    console.log('[Persistence] Reusing existing persistence layer');
    return persistenceLayerSingleton;
  }

  const operationId = persistenceMonitor.startOperation(
    'INITIALIZE_PERSISTENCE',
    { useAdapter: true }
  );

  try {
    persistenceLayerSingleton = await initializePersistenceLayer();
    self.__HTOS_PERSISTENCE_LAYER = persistenceLayerSingleton;

    persistenceMonitor.recordConnection('HTOSPersistenceDB', 1, [
      'sessions', 'threads', 'turns', 'provider_responses', 'provider_contexts', 'metadata'
    ]);

    console.log('[Persistence] ✅ Persistence layer initialized');
    persistenceMonitor.endOperation(operationId, { success: true });
    return persistenceLayerSingleton;
  } catch (error) {
    persistenceMonitor.endOperation(operationId, null, error);
    persistenceLayerSingleton = null; // Reset on failure
    const handledError = await errorHandler.handleError(error, {
      operation: 'initializePersistence',
      context: { useAdapter: true }
    });
    console.error('[Persistence] ❌ Failed to initialize:', handledError);
    throw handledError;
  }
}
```

**Find `initializeSessionManager()` function and modify**:
```javascript
async function initializeSessionManager(persistenceLayer) {
  // Reuse if adapter is ready
  if (sessionManagerSingleton && sessionManagerSingleton.adapter?.isReady()) {
    console.log('[SessionManager] Reusing existing SessionManager');
    return sessionManagerSingleton;
  }

  // Clear stale instance
  if (sessionManagerSingleton && !sessionManagerSingleton.adapter?.isReady()) {
    console.warn('[SessionManager] Clearing stale SessionManager instance');
    sessionManagerSingleton = null;
  }

  try {
    console.log('[SessionManager] Creating new SessionManager');
    sessionManagerSingleton = new SessionManager();
    sessionManagerSingleton.sessions = __HTOS_SESSIONS;
    
    await sessionManagerSingleton.initialize({ 
      adapter: persistenceLayer?.adapter 
    });

    console.log('[SessionManager] ✅ SessionManager initialized');
    return sessionManagerSingleton;
  } catch (error) {
    console.error('[SessionManager] ❌ Failed to initialize:', error);
    sessionManagerSingleton = null; // Reset on failure
    throw error;
  }
}
```

**Find `initializeGlobalServices()` and ensure this order**:
```javascript
async function initializeGlobalServices() {
  if (globalServicesPromise) return globalServicesPromise;

  globalServicesPromise = (async () => {
    console.log('[SW] 🚀 Initializing global services...');

    // 1. Infrastructure FIRST (includes OffscreenController)
    await initializeGlobalInfrastructure();
    
    // 2. THEN persistence
    const pl = await initializePersistence();
    persistenceLayer = pl;
    self.__HTOS_PERSISTENCE_LAYER = pl;
    
    // 3. Session manager (depends on persistence)
    const sessionManager = await initializeSessionManager(pl);
    
    // 4. Providers
    await initializeProviders();
    
    // 5. Orchestrator
    await initializeOrchestrator();
    
    // 6. Compiler & Resolver
    const compiler = new WorkflowCompiler(sessionManager);
    const contextResolver = new ContextResolver(sessionManager);
    
    // 7. Prompt Refiner
    promptRefinerService = new PromptRefinerService({ refinerModel: 'gemini' });
    
    console.log('[SW] ✅ Global services ready');
    return {
      orchestrator: self.faultTolerantOrchestrator,
      sessionManager,
      compiler,
      contextResolver,
      persistenceLayer: pl,
      promptRefinerService,
    };
  })();

  return globalServicesPromise;
}
```

**Explanation**: Infrastructure must be initialized before persistence (because persistence might use offscreen document for localStorage proxy). Singleton guards prevent multiple instances.

---

## 5. Add Error Boundary with onError Callback

**File**: `src/core/workflow-engine.js`

**Task**: Add `onError` callback to the orchestrator call in `executePromptStep()` method.

**Find the `executePromptStep` method and locate the `this.orchestrator.executeParallelFanout` call**.

**Add the `onError` callback** (place it after `onPartial` and before `onAllComplete`):
```javascript
onError: (error) => {
  console.error('[WorkflowEngine] Orchestrator error:', error);
  
  // Send error to UI
  try {
    this.port.postMessage({
      type: 'WORKFLOW_STEP_UPDATE',
      sessionId: context.sessionId,
      stepId: step.stepId,
      status: 'partial_failure',
      error: error.message,
    });
  } catch (e) {
    console.error('[WorkflowEngine] Failed to send error message:', e);
  }
  
  // Graceful degradation: accept partial results if available
  if (results.size > 0) {
    console.warn('[WorkflowEngine] Using partial results despite error');
    resolve({
      results: Object.fromEntries(results),
      errors: Object.fromEntries(errors),
      partial: true,
    });
  } else {
    reject(error);
  }
},
```

**Explanation**: This allows the workflow to continue with partial results if some providers succeed even when others fail.

---

## 6. Remove Session Registry (Optional - Only if You Added It)

**Task**: If you created a `src/core/session-registry.js` file, delete it entirely.

**Files to check**:
- Delete `src/core/session-registry.js` (if exists)
- Remove any imports of `sessionRegistry` from other files
- Remove any `sessionRegistry.register()` or `sessionRegistry.unregister()` calls

**Explanation**: Session registry adds overhead without meaningful benefit for your use case where workflows complete quickly.

---

## 7. Add Validation Function for Debugging

**File**: `src/sw-entry.js`

**Task**: Add a function to validate singleton state (helpful for debugging persistence issues).

**At the end of the file** (before or after the main IIFE), add:
```javascript
function validateSingletons() {
  const checks = {
    persistenceLayer: !!persistenceLayerSingleton,
    persistenceAdapter: !!persistenceLayerSingleton?.adapter,
    adapterReady: persistenceLayerSingleton?.adapter?.isReady() || false,
    sessionManager: !!sessionManagerSingleton,
    sessionManagerAdapter: !!sessionManagerSingleton?.adapter,
    adapterIsSingleton: sessionManagerSingleton?.adapter === persistenceLayerSingleton?.adapter,
  };

  console.log('[Validation] Singleton checks:', checks);
  
  const allValid = Object.values(checks).every(Boolean);
  if (!allValid) {
    console.error('[Validation] ❌ Some singletons failed validation');
  }
  
  return allValid;
}

// Expose for debugging
if (typeof globalThis !== 'undefined') {
  globalThis.__HTOS_VALIDATE_SINGLETONS = validateSingletons;
}
```

**Explanation**: Allows you to run `__HTOS_VALIDATE_SINGLETONS()` in console to verify persistence is correctly initialized.

---

## Testing After Implementation

After making all changes, test these scenarios:

1. **Startup Test**:
   - Reload extension
   - Verify no errors in console
   - Verify offscreen document loads (check chrome://extensions → Inspect views: offscreen.html)

2. **Streaming Speed Test**:
   - Send a prompt to multiple providers
   - Verify streaming feels fast (similar to original speed)
   - Check console for no "forcing flush" warnings under normal use

3. **Singleton Validation**:
   - Open console
   - Run `__HTOS_VALIDATE_SINGLETONS()`
   - Verify all checks return `true`

4. **Error Handling Test**:
   - Disconnect network
   - Send a prompt
   - Verify you see error message (not frozen spinner)
   - Reconnect network
   - Verify extension still works

5. **History Loading Test**:
   - Close and reopen chat window
   - Verify history loads at normal speed
   - Open the chat with 1.6MB response
   - Note if it's still slow (this is a separate rendering issue, not streaming)

---

## Rollback Plan

If issues occur after implementation:

1. **If offscreen document fails to load**: Check that infrastructure initialization happens before persistence initialization in `initializeGlobalServices()`.

2. **If streaming is still slow**: Verify the double RAF was actually removed (check `scheduleBatchFlush` has only one `requestAnimationFrame` call).

3. **If history doesn't load**: Run `__HTOS_VALIDATE_SINGLETONS()` and check which singleton check fails. This will tell you where the issue is.

4. **If extension doesn't start**: Check that listeners are attached at the top level BEFORE any async work. The IIFE should be after listener attachment.

---

## Summary of Changes

1. ✅ Single RAF in StreamingBuffer (16ms latency instead of 32ms)
2. ✅ SW Bootloader with correct order (listeners first, IIFE second)
3. ✅ Persistence SSOT with correct order (infrastructure first, persistence second)
4. ✅ Error boundary with onError callback (graceful degradation)
5. ✅ Simple 3000-chunk safety valve (already in StreamingBuffer)
6. ✅ Validation function for debugging

**Not included** (low value, measurable cost):
- ❌ Session registry
- ❌ Rate limiting
- ❌ Circuit breakers
- ❌ Complex memory tracking

These instructions are complete and ready to execute.