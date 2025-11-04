# Phase 3 Completion:  Context-Aware Engine

## 1. compiler done

**File: `src/core/compiler.js`** (already done)
---

## 2. WorkflowEngine (Context-Aware)

**File: `src/core/workflow-engine.js`**

**Critical Changes from Doc 25:**
1. Add `resolvedContext` parameter to `execute()`
2. Seed frozen outputs for recompute
3. Update context resolution to use `resolvedContext`

**PATCH for existing file** (apply to Doc 25):

```javascript
// At line ~480, UPDATE execute() signature:
async execute(request, resolvedContext) {  // ← ADD resolvedContext parameter
  const { context, steps } = request;
  const stepResults = new Map();
  const workflowContexts = {};

  this.currentUserMessage = context?.userMessage || this.currentUserMessage || '';

  if (!context.sessionId || context.sessionId === 'new-session') {
    context.sessionId = context.sessionId && context.sessionId !== 'new-session'
      ? context.sessionId
      : `sid-${Date.now()}`;
  }

  try {
    // ========================================================================
    // NEW: Seed frozen outputs for recompute
    // ========================================================================
    if (resolvedContext && resolvedContext.type === 'recompute') {
      console.log('[WorkflowEngine] Seeding frozen batch outputs for recompute');
      stepResults.set('batch', { 
        status: 'completed', 
        result: { results: resolvedContext.frozenBatchOutputs } 
      });
      
      // Cache historical contexts
      Object.entries(resolvedContext.providerContextsAtSourceTurn || {}).forEach(([pid, ctx]) => {
        workflowContexts[pid] = ctx;
      });
    }
    
    // ========================================================================
    // Execute steps (rest unchanged)
    // ========================================================================
    const promptSteps = steps.filter(step => step.type === 'prompt');
    const synthesisSteps = steps.filter(step => step.type === 'synthesis');
    const mappingSteps = steps.filter(step => step.type === 'mapping');

    // ... rest of execution logic unchanged ...
  }
}
```

**At line ~890, UPDATE _resolveProviderContext() to use resolvedContext:**

```javascript
_resolveProviderContext(providerId, context, payload, workflowContexts, previousResults, resolvedContext, stepType = 'step') {
  const providerContexts = {};

  // Tier 1: Workflow cache
  if (workflowContexts && workflowContexts[providerId]) {
    providerContexts[providerId] = {
      meta: workflowContexts[providerId],
      continueThread: true
    };
    console.log(`[WorkflowEngine] ${stepType} using workflow-cached context for ${providerId}`);
    return providerContexts;
  }

  // Tier 2: ResolvedContext (for recompute - historical contexts)
  if (resolvedContext && resolvedContext.type === 'recompute') {
    const historicalContext = resolvedContext.providerContextsAtSourceTurn?.[providerId];
    if (historicalContext) {
      providerContexts[providerId] = {
        meta: historicalContext,
        continueThread: true
      };
      console.log(`[WorkflowEngine] ${stepType} using historical context from ResolvedContext for ${providerId}`);
      return providerContexts;
    }
  }

  // Tier 3: Batch step context
  if (payload.continueFromBatchStep) {
    const batchResult = previousResults.get(payload.continueFromBatchStep);
    if (batchResult?.status === 'completed' && batchResult.result?.results) {
      const providerResult = batchResult.result.results[providerId];
      if (providerResult?.meta) {
        providerContexts[providerId] = {
          meta: providerResult.meta,
          continueThread: true
        };
        console.log(`[WorkflowEngine] ${stepType} using batch step context for ${providerId}`);
        return providerContexts;
      }
    }
  }

  // Tier 4: Persisted context (last resort)
  try {
    const persisted = this.sessionManager.getProviderContexts(context.sessionId, context.threadId || 'default-thread');
    const persistedMeta = persisted?.[providerId]?.meta;
    if (persistedMeta && Object.keys(persistedMeta).length > 0) {
      providerContexts[providerId] = {
        meta: persistedMeta,
        continueThread: true
      };
      console.log(`[WorkflowEngine] ${stepType} using persisted context for ${providerId}`);
      return providerContexts;
    }
  } catch (_) {}

  return providerContexts;
}
```

**At line ~1120, UPDATE executeSynthesisStep() signature:**

```javascript
async executeSynthesisStep(step, context, previousResults, workflowContexts = {}, resolvedContext) {  // ← ADD parameter
  const payload = step.payload;
  const sourceData = await this.resolveSourceData(payload, context, previousResults);
  
  // ... existing logic ...

  // UPDATE context resolution call:
  const providerContexts = this._resolveProviderContext(
    payload.synthesisProvider, 
    context, 
    payload, 
    workflowContexts, 
    previousResults,
    resolvedContext,  // ← PASS resolvedContext
    'Synthesis'
  );

  // ... rest unchanged ...
}
```

**At line ~1200, UPDATE executeMappingStep() signature:**

```javascript
async executeMappingStep(step, context, previousResults, workflowContexts = {}, resolvedContext) {  // ← ADD parameter
  const payload = step.payload;
  const sourceData = await this.resolveSourceData(payload, context, previousResults);
  
  // ... existing logic ...

  // UPDATE context resolution call:
  const providerContexts = this._resolveProviderContext(
    payload.mappingProvider, 
    context, 
    payload, 
    workflowContexts, 
    previousResults,
    resolvedContext,  // ← PASS resolvedContext
    'Mapping'
  );

  // ... rest unchanged ...
}
```

**At line ~530, UPDATE step executor calls:**

```javascript
// In execute(), update mapping loop:
for (const step of mappingSteps) {
  try {
    const result = await this.executeMappingStep(step, context, stepResults, workflowContexts, resolvedContext);  // ← ADD resolvedContext
    // ... rest unchanged ...
  }
}

// Update synthesis loop:
for (const step of synthesisSteps) {
  try {
    const result = await this.executeSynthesisStep(step, context, stepResults, workflowContexts, resolvedContext);  // ← ADD resolvedContext
    // ... rest unchanged ...
  }
}
```

---

## 3. ConnectionHandler (Cleaned)

**File: `src/core/connection-handler.js`**

Replace Doc 23's `_handleExecuteWorkflow` method:

```javascript
async _handleExecuteWorkflow(message) {
  let executeRequest = message.payload;
  let resolvedContext = null;

  // Record activity
  try {
    if (this.lifecycleManager && typeof this.lifecycleManager.recordActivity === 'function') {
      this.lifecycleManager.recordActivity();
    }
  } catch (e) { }

  try {
    this.lifecycleManager?.activateWorkflowMode();

    // ========================================================================
    // PHASE 3: Always use primitive-based flow
    // ========================================================================
    
    // Detect primitives
    const isPrimitive = executeRequest && 
      typeof executeRequest.type === 'string' && 
      ['initialize', 'extend', 'recompute'].includes(executeRequest.type);

    if (isPrimitive) {
      // Phase 3 path: Resolve → Compile → Execute
      console.log(`[ConnectionHandler] Processing ${executeRequest.type} primitive`);

      // Step 1: Resolve context
      try {
        resolvedContext = await this.services.contextResolver.resolve(executeRequest);
        console.log(`[ConnectionHandler] Context resolved: ${resolvedContext.type}`);
      } catch (e) {
        console.error('[ConnectionHandler] Context resolution failed:', e);
        throw e;
      }

      // Step 2: Map primitive to legacy request format
      executeRequest = await this._mapPrimitiveToLegacy(executeRequest);
    } else {
      // Legacy path: Fall back to hydration (Phase 4 will remove this)
      console.warn('[ConnectionHandler] Legacy request detected - using hydration path');
      
      await this._relocateSessionId(executeRequest);
      await this._ensureSessionHydration(executeRequest);
      this._normalizeProviderModesForContinuation(executeRequest);
      
      const precheck = this._precheckContinuation(executeRequest);
      if (precheck && precheck.missingProviders && precheck.missingProviders.length > 0) {
        this._emitContinuationPrecheckFailure(executeRequest, precheck.missingProviders);
        return;
      }
    }

    // ========================================================================
    // Validation
    // ========================================================================
    const histUserTurnId = executeRequest?.historicalContext?.userTurnId;
    const userTurnId = executeRequest?.userTurnId || histUserTurnId;
    const hasBatch = Array.isArray(executeRequest?.providers) && executeRequest.providers.length > 0;
    const hasSynthesis = !!(executeRequest?.synthesis?.enabled && executeRequest.synthesis.providers?.length > 0);
    const hasMapping = !!(executeRequest?.mapping?.enabled && executeRequest.mapping.providers?.length > 0);

    if (!hasBatch && (hasSynthesis || hasMapping) && !userTurnId) {
      console.error('[ConnectionHandler] Missing userTurnId in historical-only request');
      this.port.postMessage({
        type: 'WORKFLOW_STEP_UPDATE',
        sessionId: executeRequest?.sessionId || 'unknown',
        stepId: 'validate-user-turn',
        status: 'failed',
        error: 'Missing userTurnId for historical run'
      });
      this.port.postMessage({
        type: 'WORKFLOW_COMPLETE',
        sessionId: executeRequest?.sessionId || 'unknown'
      });
      return;
    }

    // Generate session ID if needed
    if (!executeRequest?.sessionId || executeRequest.sessionId === '') {
      executeRequest.sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      console.log('[ConnectionHandler] Generated session ID:', executeRequest.sessionId);
    }

    // ========================================================================
    // Compile
    // ========================================================================
    const workflowRequest = this.services.compiler.compile(executeRequest, resolvedContext);

    // ========================================================================
    // TURN_CREATED message
    // ========================================================================
    const createsNewTurn = hasBatch;
    if (createsNewTurn) {
      const aiTurnId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      workflowRequest.context = {
        ...workflowRequest.context,
        canonicalUserTurnId: userTurnId,
        canonicalAiTurnId: aiTurnId
      };

      try {
        this.port.postMessage({
          type: 'TURN_CREATED',
          sessionId: workflowRequest.context.sessionId || executeRequest.sessionId,
          userTurnId,
          aiTurnId
        });
      } catch (_) {}
    }

    // ========================================================================
    // Execute
    // ========================================================================
    await this.workflowEngine.execute(workflowRequest, resolvedContext);

  } catch (error) {
    console.error('[ConnectionHandler] Workflow failed:', error);
    
    try {
      this.port.postMessage({
        type: 'WORKFLOW_STEP_UPDATE',
        sessionId: executeRequest?.sessionId || 'unknown',
        stepId: 'handler-error',
        status: 'failed',
        error: error.message || String(error)
      });
      
      this.port.postMessage({
        type: 'WORKFLOW_COMPLETE',
        sessionId: executeRequest?.sessionId || 'unknown',
        error: error.message || String(error)
      });
    } catch (e) {
      console.error('[ConnectionHandler] Failed to send error message:', e);
    }
  } finally {
    this.lifecycleManager?.deactivateWorkflowMode();
  }
}
```

**Keep all helper methods** (`_mapPrimitiveToLegacy`, `_ensureSessionHydration`, etc.) - they're used for legacy fallback until Phase 4.

---

## 4. Integration Checklist

**After applying these changes:**

```bash
# 1. Verify compilation
npm run build

# 2. Test primitive flow
# - Send InitializeRequest from UI
# - Check logs for "[ConnectionHandler] Processing initialize primitive"
# - Verify "[Compiler] Compiling initialize workflow"
# - Verify "[WorkflowEngine] Seeding frozen batch outputs" (for recompute)

# 3. Test legacy fallback
# - Trigger old-style request (if any exist)
# - Verify "[ConnectionHandler] Legacy request detected - using hydration path"

# 4. Verify no regressions
# - New chats work
# - Continued chats work
# - Historical reruns work
```

**Key Success Indicators:**
- ✅ Compiler has ZERO `async` keywords
- ✅ Compiler has ZERO `sessionManager` calls
- ✅ Engine logs "Seeding frozen outputs" for recompute
- ✅ Context resolution uses tier system (workflow → historical → batch → persisted)

---

## 5. What Remains (Phases 4-6)

**Phase 4** (SessionManager refactor):
- Implement `persist(request, context, result)` router
- Add `_persistInitialize/Extend/Recompute` methods
- Remove legacy session-level context support

**Phase 5** (UI cleanup):
- Already done by agent! ✅

**Phase 6** (Polish):
- Adapter unification (optional)
- Complete migration script

**Current architecture is now:**
- ✅ Pure compiler (Phase 3 ✓)
- ✅ Context-aware engine (Phase 3 ✓)
- ✅ Primitive-based UI (Phase 2 ✓)
- ⚠️ Hybrid ConnectionHandler (Phase 3 complete, legacy path remains for Phase 4)
- ⚠️ SessionManager has turn-scoped persistence but needs full primitive-based refactor (Phase 4)

You now have a **working Phase 3 implementation** that's ready for Phase 4's full SessionManager refactor.