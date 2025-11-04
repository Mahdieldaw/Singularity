# Phase 4: Turn-Based Persistence - Complete Implementation Guide

## Mission
Transform SessionManager from legacy turn persistence to primitive-based persistence with three explicit methods: `_persistInitialize`, `_persistExtend`, `_persistRecompute`. This is the final critical refactor to complete the turn-based architecture.

---

## Pre-Flight Checklist

**Before starting Phase 4, verify Phase 3 is complete:**

```bash
# 1. Check compiler is pure (no async)
grep -n "async" src/core/workflow-compiler.js
# ✅ Should find ZERO matches (except in comments)

# 2. Check engine has resolvedContext parameter
grep -n "execute(request, resolvedContext)" src/core/workflow-engine.js
# ✅ Should find the signature

# 3. Check ContextResolver is wired
grep -n "contextResolver.resolve" src/core/connection-handler.js
# ✅ Should find the call in _handleExecuteWorkflow

# 4. Verify UI sends primitives
grep -n "type: 'initialize'" ui/hooks/useChat.ts
grep -n "type: 'extend'" ui/hooks/useChat.ts
grep -n "type: 'recompute'" ui/hooks/useRoundActions.ts
# ✅ Should find all three
```

**If any checks fail, complete Phase 3 first.**

---

## Part 1: Update WorkflowEngine to Call New Persistence

**File: `src/core/workflow-engine.js`**

### Step 1.1: Update `_persistCriticalTurnData` Method

**Location:** Around line 600 in Doc 25 (workflow-engine.js)

**Find this method:**
```javascript
async _persistCriticalTurnData(context, steps, stepResults) {
```

**Replace entire method with:**

```javascript
/**
 * NEW: Persist using primitive-based SessionManager.persist()
 * Replaces old saveTurn() approach with context-aware routing
 */
async _persistCriticalTurnData(context, steps, stepResults, resolvedContext) {
  // Skip for historical reruns (no new turn created)
  if (context?.targetUserTurnId) {
    console.log('[WorkflowEngine] Skipping critical persistence (historical rerun)');
    return;
  }

  const userMessage = context?.userMessage || this.currentUserMessage || '';
  if (!userMessage) {
    console.log('[WorkflowEngine] Skipping persistence (no user message)');
    return;
  }

  try {
    // ========================================================================
    // Extract results from step execution
    // ========================================================================
    const result = {
      batchOutputs: {},
      synthesisOutputs: {},
      mappingOutputs: {}
    };
    
    stepResults.forEach((stepResult, stepId) => {
      if (stepResult.status !== 'completed') return;
      
      const step = steps.find(s => s.stepId === stepId);
      if (!step) return;
      
      if (step.type === 'prompt') {
        result.batchOutputs = stepResult.result?.results || {};
      } else if (step.type === 'synthesis') {
        const providerId = step.payload.synthesisProvider;
        result.synthesisOutputs[providerId] = stepResult.result;
      } else if (step.type === 'mapping') {
        const providerId = step.payload.mappingProvider;
        result.mappingOutputs[providerId] = stepResult.result;
      }
    });

    // ========================================================================
    // Construct request object for persistence
    // ========================================================================
    const request = {
      type: resolvedContext?.type || 'unknown',
      sessionId: context.sessionId,
      userMessage: userMessage
    };

    // Add recompute-specific fields
    if (resolvedContext?.type === 'recompute') {
      request.sourceTurnId = resolvedContext.sourceTurnId;
      request.stepType = resolvedContext.stepType;
      request.targetProvider = resolvedContext.targetProvider;
    }

    console.log(`[WorkflowEngine] Persisting ${request.type} workflow to SessionManager`);

    // ========================================================================
    // Call new primitive-based persist method
    // ========================================================================
    const persistResult = await this.sessionManager.persist(request, resolvedContext, result);

    // ========================================================================
    // Update workflow context with canonical IDs
    // ========================================================================
    if (persistResult) {
      context.canonicalUserTurnId = persistResult.userTurnId;
      context.canonicalAiTurnId = persistResult.aiTurnId;
      
      // For initialize, update sessionId from persistence
      if (resolvedContext?.type === 'initialize' && persistResult.sessionId) {
        context.sessionId = persistResult.sessionId;
        console.log(`[WorkflowEngine] Initialize complete: session=${persistResult.sessionId}`);
      }
    }

  } catch (error) {
    console.error('[WorkflowEngine] Critical persistence failed:', error);
    throw error; // Fail loudly - persistence is critical
  }
}
```

### Step 1.2: Update Persistence Call in `execute()`

**Location:** Around line 570 in Doc 25

**Find this block:**
```javascript
// --- NEW HYBRID APPROACH ---
// 1) Persist CRITICAL data immediately and await it
try {
  await this._persistCriticalTurnData(context, steps, stepResults);
} catch (e) {
  console.error('[WorkflowEngine] CRITICAL persistence failed:', e);
}
```

**Replace with:**
```javascript
// ========================================================================
// Persistence: Call new primitive-based method
// ========================================================================
try {
  await this._persistCriticalTurnData(context, steps, stepResults, resolvedContext);
} catch (e) {
  console.error('[WorkflowEngine] CRITICAL persistence failed:', e);
  // Still notify UI to avoid hanging
}
```

### Step 1.3: Update Non-Critical Persistence Call

**Location:** Around line 585

**Find:**
```javascript
setTimeout(() => {
  this._persistNonCriticalData(context, steps, stepResults).catch(e => {
```

**Replace with:**
```javascript
setTimeout(() => {
  this._persistNonCriticalData(context, steps, stepResults, resolvedContext).catch(e => {
```

### Step 1.4: Update `_persistNonCriticalData` Signature

**Location:** Around line 750

**Find:**
```javascript
async _persistNonCriticalData(context, steps, stepResults) {
```

**Replace with:**
```javascript
async _persistNonCriticalData(context, steps, stepResults, resolvedContext) {
```

**(Keep method body unchanged - it already uses `appendProviderResponses` which will work with new SessionManager)**

---

## Part 2: Implement New SessionManager Methods

**File: `src/persistence/SessionManager.js`**

### Step 2.1: Add Primary `persist()` Router

**Location:** Add after `constructor()` (around line 20 in Doc 26)

**Insert this new method:**

```javascript
/**
 * NEW: Primary persistence entry point (Phase 4)
 * Routes to appropriate primitive-specific handler
 * 
 * @param {Object} request - { type, sessionId, userMessage, sourceTurnId?, stepType?, targetProvider? }
 * @param {ResolvedContext} context - Resolved context from ContextResolver
 * @param {Object} result - { batchOutputs, synthesisOutputs, mappingOutputs }
 * @returns {Promise<{sessionId, userTurnId, aiTurnId}>}
 */
async persist(request, context, result) {
  console.log(`[SessionManager] persist() called: type=${request.type}`);
  
  if (!request?.type) {
    throw new Error('[SessionManager] persist() requires request.type');
  }

  switch (request.type) {
    case 'initialize':
      return this._persistInitialize(request, result);
    
    case 'extend':
      return this._persistExtend(request, context, result);
    
    case 'recompute':
      return this._persistRecompute(request, context, result);
    
    default:
      throw new Error(`[SessionManager] Unknown request type: ${request.type}`);
  }
}
```

### Step 2.2: Implement `_persistInitialize()`

**Location:** Add after `persist()` method

**Insert this method:**

```javascript
/**
 * Initialize: Create new session + first turn
 */
async _persistInitialize(request, result) {
  const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  
  console.log(`[SessionManager] _persistInitialize: Creating session ${sessionId}`);

  // ========================================================================
  // 1. Create session record
  // ========================================================================
  const sessionRecord = {
    id: sessionId,
    title: request.userMessage.slice(0, 50),
    createdAt: now,
    lastActivity: now,
    defaultThreadId: 'default-thread',
    activeThreadId: 'default-thread',
    turnCount: 2, // user + ai
    isActive: true,
    lastTurnId: null, // will be set after turn creation
    updatedAt: now,
    userId: 'default-user',
    provider: 'multi'
  };
  
  await this.adapter.put('sessions', sessionRecord);
  console.log('[SessionManager] Session record created');

  // ========================================================================
  // 2. Create default thread
  // ========================================================================
  const defaultThread = {
    id: 'default-thread',
    sessionId,
    parentThreadId: null,
    branchPointTurnId: null,
    name: 'Main Thread',
    title: 'Main Thread',
    color: '#6366f1',
    isActive: true,
    createdAt: now,
    lastActivity: now,
    updatedAt: now
  };
  
  await this.adapter.put('threads', defaultThread);
  console.log('[SessionManager] Default thread created');

  // ========================================================================
  // 3. Create user turn
  // ========================================================================
  const userTurnId = `user-${now}`;
  const userTurnRecord = {
    id: userTurnId,
    type: 'user',
    sessionId,
    threadId: 'default-thread',
    createdAt: now,
    updatedAt: now,
    content: request.userMessage,
    turnType: 'initialize',
    sequence: 0
  };
  
  await this.adapter.put('turns', userTurnRecord);
  console.log('[SessionManager] User turn created');

  // ========================================================================
  // 4. Create AI turn with turn-scoped contexts
  // ========================================================================
  const aiTurnId = `ai-${now}`;
  const providerContexts = this._extractContextsFromResult(result);
  
  const aiTurnRecord = {
    id: aiTurnId,
    type: 'ai',
    sessionId,
    threadId: 'default-thread',
    userTurnId,
    createdAt: now,
    updatedAt: now,
    turnType: 'initialize',
    providerContexts, // ✅ NEW: Turn-scoped contexts
    sequence: 1,
    batchResponseCount: Object.keys(result.batchOutputs || {}).length,
    synthesisResponseCount: Object.keys(result.synthesisOutputs || {}).length,
    mappingResponseCount: Object.keys(result.mappingOutputs || {}).length
  };
  
  await this.adapter.put('turns', aiTurnRecord);
  console.log('[SessionManager] AI turn created with turn-scoped contexts');

  // ========================================================================
  // 5. Persist provider responses
  // ========================================================================
  await this._persistProviderResponses(sessionId, aiTurnId, result, now);
  console.log('[SessionManager] Provider responses persisted');

  // ========================================================================
  // 6. Update session with lastTurnId
  // ========================================================================
  sessionRecord.lastTurnId = aiTurnId;
  await this.adapter.put('sessions', sessionRecord);

  // ========================================================================
  // 7. Update in-memory cache
  // ========================================================================
  const legacySession = await this.buildLegacySessionObject(sessionId);
  this.sessions[sessionId] = legacySession;
  
  console.log(`[SessionManager] Initialize complete: session=${sessionId}`);
  
  return { sessionId, userTurnId, aiTurnId };
}
```

### Step 2.3: Implement `_persistExtend()`

**Location:** Add after `_persistInitialize()`

**Insert this method:**

```javascript
/**
 * Extend: Append turn to existing session
 */
async _persistExtend(request, context, result) {
  const { sessionId } = request;
  const now = Date.now();
  
  console.log(`[SessionManager] _persistExtend: Extending session ${sessionId}`);

  // ========================================================================
  // 1. Get last turn to inherit contexts
  // ========================================================================
  if (!context?.lastTurnId) {
    throw new Error('[SessionManager] Extend requires context.lastTurnId');
  }

  const lastTurn = await this.adapter.get('turns', context.lastTurnId);
  if (!lastTurn) {
    throw new Error(`[SessionManager] Last turn ${context.lastTurnId} not found`);
  }
  
  console.log(`[SessionManager] Found last turn: ${lastTurn.id}`);

  // ========================================================================
  // 2. Get next sequence
  // ========================================================================
  const allTurns = await this.adapter.getAll('turns');
  const sessionTurns = allTurns.filter(t => t.sessionId === sessionId);
  const nextSequence = sessionTurns.length;

  // ========================================================================
  // 3. Create user turn
  // ========================================================================
  const userTurnId = `user-${now}`;
  const userTurnRecord = {
    id: userTurnId,
    type: 'user',
    sessionId,
    threadId: 'default-thread',
    createdAt: now,
    updatedAt: now,
    content: request.userMessage,
    turnType: 'extend',
    parentTurnId: context.lastTurnId,
    sequence: nextSequence
  };
  
  await this.adapter.put('turns', userTurnRecord);
  console.log('[SessionManager] User turn created');

  // ========================================================================
  // 4. Merge contexts: keep old for unused providers, update for used ones
  // ========================================================================
  const newContexts = this._extractContextsFromResult(result);
  const mergedContexts = {
    ...(lastTurn.providerContexts || {}),
    ...newContexts
  };
  
  console.log('[SessionManager] Merged contexts:', {
    inherited: Object.keys(lastTurn.providerContexts || {}),
    new: Object.keys(newContexts),
    merged: Object.keys(mergedContexts)
  });

  // ========================================================================
  // 5. Create AI turn with merged contexts
  // ========================================================================
  const aiTurnId = `ai-${now}`;
  const aiTurnRecord = {
    id: aiTurnId,
    type: 'ai',
    sessionId,
    threadId: 'default-thread',
    userTurnId,
    createdAt: now,
    updatedAt: now,
    turnType: 'extend',
    parentTurnId: userTurnId,
    providerContexts: mergedContexts, // ✅ Merged contexts
    sequence: nextSequence + 1,
    batchResponseCount: Object.keys(result.batchOutputs || {}).length,
    synthesisResponseCount: Object.keys(result.synthesisOutputs || {}).length,
    mappingResponseCount: Object.keys(result.mappingOutputs || {}).length
  };
  
  await this.adapter.put('turns', aiTurnRecord);
  console.log('[SessionManager] AI turn created with merged contexts');

  // ========================================================================
  // 6. Persist provider responses
  // ========================================================================
  await this._persistProviderResponses(sessionId, aiTurnId, result, now);

  // ========================================================================
  // 7. Update session
  // ========================================================================
  const session = await this.adapter.get('sessions', sessionId);
  session.lastTurnId = aiTurnId;
  session.lastActivity = now;
  session.turnCount += 2;
  session.updatedAt = now;
  await this.adapter.put('sessions', session);

  // ========================================================================
  // 8. Update in-memory cache
  // ========================================================================
  const legacySession = await this.buildLegacySessionObject(sessionId);
  this.sessions[sessionId] = legacySession;
  
  console.log(`[SessionManager] Extend complete: aiTurn=${aiTurnId}`);
  
  return { sessionId, userTurnId, aiTurnId };
}
```

### Step 2.4: Implement `_persistRecompute()`

**Location:** Add after `_persistExtend()`

**Insert this method:**

```javascript
/**
 * Recompute: Create derived turn (timeline branch)
 */
async _persistRecompute(request, context, result) {
  const { sessionId, sourceTurnId, stepType, targetProvider } = request;
  const now = Date.now();
  
  console.log(`[SessionManager] _persistRecompute: Creating derived turn for ${sourceTurnId}`);

  // ========================================================================
  // 1. Get source turn
  // ========================================================================
  const sourceTurn = await this.adapter.get('turns', sourceTurnId);
  if (!sourceTurn) {
    throw new Error(`[SessionManager] Source turn ${sourceTurnId} not found`);
  }

  // ========================================================================
  // 2. Create derived AI turn (NOT advancing main timeline)
  // ========================================================================
  const aiTurnId = `ai-recompute-${now}`;
  const aiTurnRecord = {
    id: aiTurnId,
    type: 'ai',
    sessionId,
    threadId: 'default-thread',
    userTurnId: sourceTurn.userTurnId || sourceTurnId,
    createdAt: now,
    updatedAt: now,
    turnType: 'recompute',
    parentTurnId: sourceTurnId,
    sourceTurnId,
    providerContexts: context.providerContextsAtSourceTurn || {}, // ✅ Historical contexts
    sequence: -1, // Off main timeline
    batchResponseCount: 0, // No batch (frozen outputs used)
    synthesisResponseCount: stepType === 'synthesis' ? 1 : 0,
    mappingResponseCount: stepType === 'mapping' ? 1 : 0,
    meta: {
      isHistoricalRerun: true,
      recomputeMetadata: {
        stepType,
        targetProvider
      }
    }
  };
  
  await this.adapter.put('turns', aiTurnRecord);
  console.log('[SessionManager] Recompute turn created (off main timeline)');

  // ========================================================================
  // 3. Persist only the recomputed response
  // ========================================================================
  const responseId = `pr-${sessionId}-${aiTurnId}-${targetProvider}-${stepType}-0-${now}`;
  const responseData = stepType === 'synthesis' 
    ? result.synthesisOutputs?.[targetProvider]
    : result.mappingOutputs?.[targetProvider];
    
  if (!responseData) {
    console.warn(`[SessionManager] No ${stepType} output found for ${targetProvider}`);
  } else {
    const responseRecord = {
      id: responseId,
      sessionId,
      aiTurnId,
      providerId: targetProvider,
      responseType: stepType,
      responseIndex: 0,
      text: responseData.text || '',
      status: 'completed',
      meta: responseData.meta || {},
      createdAt: now,
      updatedAt: now,
      completedAt: now
    };
    
    await this.adapter.put('provider_responses', responseRecord);
    console.log(`[SessionManager] ${stepType} response persisted`);
  }

  // ========================================================================
  // 4. DO NOT update session.lastTurnId (this is a branch)
  // ========================================================================
  console.log('[SessionManager] Skipping session.lastTurnId update (recompute is off timeline)');

  // ========================================================================
  // 5. Update in-memory cache
  // ========================================================================
  const legacySession = await this.buildLegacySessionObject(sessionId);
  this.sessions[sessionId] = legacySession;
  
  console.log(`[SessionManager] Recompute complete: derived turn=${aiTurnId}`);
  
  return { sessionId, aiTurnId };
}
```

### Step 2.5: Add Helper Methods

**Location:** Add after the three persist methods

**Insert these helpers:**

```javascript
/**
 * Extract provider contexts from workflow result
 * Looks in batch/synthesis/mapping outputs for meta fields
 */
_extractContextsFromResult(result) {
  const contexts = {};
  
  // Extract from batch outputs
  for (const [providerId, output] of Object.entries(result.batchOutputs || {})) {
    if (output?.meta && Object.keys(output.meta).length > 0) {
      contexts[providerId] = output.meta;
    }
  }
  
  // Extract from synthesis outputs
  for (const [providerId, output] of Object.entries(result.synthesisOutputs || {})) {
    if (output?.meta && Object.keys(output.meta).length > 0) {
      contexts[providerId] = output.meta;
    }
  }
  
  // Extract from mapping outputs
  for (const [providerId, output] of Object.entries(result.mappingOutputs || {})) {
    if (output?.meta && Object.keys(output.meta).length > 0) {
      contexts[providerId] = output.meta;
    }
  }
  
  console.log('[SessionManager] Extracted contexts from result:', Object.keys(contexts));
  
  return contexts;
}

/**
 * Helper: Persist provider responses for a turn
 * Handles batch, synthesis, and mapping responses
 */
async _persistProviderResponses(sessionId, aiTurnId, result, now) {
  let count = 0;

  // Batch responses
  for (const [providerId, output] of Object.entries(result.batchOutputs || {})) {
    const respId = `pr-${sessionId}-${aiTurnId}-${providerId}-batch-0-${now}-${count++}`;
    await this.adapter.put('provider_responses', {
      id: respId,
      sessionId,
      aiTurnId,
      providerId,
      responseType: 'batch',
      responseIndex: 0,
      text: output?.text || '',
      status: output?.status || 'completed',
      meta: output?.meta || {},
      createdAt: now,
      updatedAt: now,
      completedAt: now
    });
  }

  // Synthesis responses
  for (const [providerId, output] of Object.entries(result.synthesisOutputs || {})) {
    const respId = `pr-${sessionId}-${aiTurnId}-${providerId}-synthesis-0-${now}-${count++}`;
    await this.adapter.put('provider_responses', {
      id: respId,
      sessionId,
      aiTurnId,
      providerId,
      responseType: 'synthesis',
      responseIndex: 0,
      text: output?.text || '',
      status: output?.status || 'completed',
      meta: output?.meta || {},
      createdAt: now,
      updatedAt: now,
      completedAt: now
    });
  }

  // Mapping responses
  for (const [providerId, output] of Object.entries(result.mappingOutputs || {})) {
    const respId = `pr-${sessionId}-${aiTurnId}-${providerId}-mapping-0-${now}-${count++}`;
    await this.adapter.put('provider_responses', {
      id: respId,
      sessionId,
      aiTurnId,
      providerId,
      responseType: 'mapping',
      responseIndex: 0,
      text: output?.text || '',
      status: output?.status || 'completed',
      meta: output?.meta || {},
      createdAt: now,
      updatedAt: now,
      completedAt: now
    });
  }

  console.log(`[SessionManager] Persisted ${count} provider responses`);
}
```

---

## Part 3: Update Legacy Methods (Backward Compatibility)

### Step 3.1: Mark Old Methods as Deprecated

**Location:** Find `saveTurnWithPersistence()` method (around line 800 in Doc 26)

**Add deprecation notice at top of method:**

```javascript
/**
 * DEPRECATED: Legacy turn persistence
 * Use persist() with primitives instead
 * Kept for backward compatibility during Phase 4 transition
 */
async saveTurnWithPersistence(sessionId, userTurn, aiTurn) {
  console.warn('[SessionManager] DEPRECATED: saveTurnWithPersistence() called. Migrate to persist().');
  
  // ... rest of existing method unchanged ...
}
```

### Step 3.2: Update `saveTurn()` to Route to New Method

**Location:** Find `saveTurn()` method (around line 700)

**Replace entire method:**

```javascript
/**
 * Save turn (legacy compatibility wrapper)
 * Routes to new persist() method when possible
 */
async saveTurn(sessionId, userTurn, aiTurn) {
  // Try to detect if this is being called from new workflow engine
  // (has providerContexts on aiTurn) vs legacy code
  const hasNewContexts = aiTurn?.providerContexts && Object.keys(aiTurn.providerContexts).length > 0;
  
  if (hasNewContexts) {
    console.log('[SessionManager] saveTurn: Detected new format, routing to persist()');
    
    // Extract result from turn structure
    const result = {
      batchOutputs: aiTurn.batchResponses || {},
      synthesisOutputs: aiTurn.synthesisResponses || {},
      mappingOutputs: aiTurn.mappingResponses || {}
    };
    
    // Determine primitive type based on session state
    let requestType = 'extend';
    try {
      const session = await this.adapter.get('sessions', sessionId);
      if (!session || !session.lastTurnId) {
        requestType = 'initialize';
      }
    } catch {
      requestType = 'initialize';
    }
    
    const request = {
      type: requestType,
      sessionId,
      userMessage: userTurn.text || ''
    };
    
    const context = requestType === 'extend' 
      ? { type: 'extend', sessionId, lastTurnId: aiTurn.parentTurnId, providerContexts: aiTurn.providerContexts }
      : { type: 'initialize', providers: Object.keys(result.batchOutputs) };
    
    return this.persist(request, context, result);
  }
  
  // Fall back to legacy method
  console.log('[SessionManager] saveTurn: Using legacy persistence path');
  return this.saveTurnWithPersistence(sessionId, userTurn, aiTurn);
}
```

---

## Part 4: Verification Tests

### Test 4.1: Initialize Flow

**Create test file: `test-phase4-initialize.js`**

```javascript
// Manual test script - run in browser console on your extension
(async function testInitialize() {
  console.log('=== PHASE 4 TEST: Initialize ===');
  
  // Simulate InitializeRequest from UI
  const request = {
    type: 'initialize',
    userMessage: 'Test initialize flow',
    providers: ['claude', 'gemini'],
    includeMapping: false,
    includeSynthesis: false
  };
  
  // Send to backend
  await chrome.runtime.sendMessage({
    type: 'EXECUTE_WORKFLOW',
    payload: request
  });
  
  console.log('✅ Initialize request sent. Check logs for:');
  console.log('  - [ContextResolver] Initialize: No context to fetch');
  console.log('  - [Compiler] Compiling initialize workflow');
  console.log('  - [WorkflowEngine] Persisting initialize workflow');
  console.log('  - [SessionManager] _persistInitialize: Creating session');
  console.log('  - [SessionManager] Initialize complete');
})();
```

**Expected log sequence:**
```
[ConnectionHandler] Processing initialize primitive
[ContextResolver] Initialize: No context to fetch (starting fresh)
[Compiler] Compiling initialize workflow
[Compiler] Generated 1 steps
[WorkflowEngine] Persisting initialize workflow to SessionManager
[SessionManager] persist() called: type=initialize
[SessionManager] _persistInitialize: Creating session session-xxx
[SessionManager] Session record created
[SessionManager] Default thread created
[SessionManager] User turn created
[SessionManager] AI turn created with turn-scoped contexts
[SessionManager] Extracted contexts from result: ['claude', 'gemini']
[SessionManager] Persisted 2 provider responses
[SessionManager] Initialize complete: session=session-xxx
```

### Test 4.2: Extend Flow

**Create test file: `test-phase4-extend.js`**

```javascript
(async function testExtend() {
  console.log('=== PHASE 4 TEST: Extend ===');
  
  // Get current session from first test
  const sessionId = 'session-xxx'; // Replace with actual session ID from test 4.1
  
  const request = {
    type: 'extend',
    sessionId: sessionId,
    userMessage: 'Follow-up message',
    providers: ['claude', 'gemini'],
    includeMapping: false,
    includeSynthesis: false
  };
  
  await chrome.runtime.sendMessage({
    type: 'EXECUTE_WORKFLOW',
    payload: request
  });
  
  console.log('✅ Extend request sent. Check logs for:');
  console.log('  - [ContextResolver] Extend: Loaded contexts for N providers');
  console.log('  - [SessionManager] _persistExtend: Extending session');
  console.log('  - [SessionManager] Merged contexts');
})();
```

**Expected log sequence:**
```
[ConnectionHandler] Processing extend primitive
[ContextResolver] Extend: Loaded contexts for 2 providers from turn ai-xxx
[Compiler] Compiling extend workflow
[WorkflowEngine] Persisting extend workflow to SessionManager
[SessionManager] persist() called: type=extend
[SessionManager] _persistExtend: Extending session session-xxx
[SessionManager] Found last turn: ai-xxx
[SessionManager] Merged contexts: {inherited: ['claude', 'gemini'], new: ['claude', 'gemini'], merged: ['claude', 'gemini']}
[SessionManager] Extend complete: aiTurn=ai-yyy
```

### Test 4.3: Recompute Flow

**Create test file: `test-phase4-recompute.js`**

```javascript
(async function testRecompute() {
  console.log('=== PHASE 4 TEST: Recompute ===');
  
  const sessionId = 'session-xxx'; // From previous tests
  const userTurnId = 'user-xxx'; // From previous tests
  
  const request = {
    type: 'recompute',
    sessionId: sessionId,
    sourceTurnId: userTurnId,
    stepType: 'synthesis',
    targetProvider: 'claude'
  };
  
  await chrome.runtime.sendMessage({
    type: 'EXECUTE_WORKFLOW',
    payload: request
  });
  
  console.log('✅ Recompute request sent. Check logs for:');
  console.log('  - [ContextResolver] Recompute: Loaded frozen outputs');
  console.log('  - [WorkflowEngine] Seeding frozen batch outputs');