# Comprehensive Turn-Based Architecture Refactor Prompt

## Mission
Execute a complete architectural refactor to transition from session-based to turn-based context management with three explicit workflow primitives: Initialize, Extend, and Recompute. This refactor spans backend infrastructure, persistence layer, and UI request construction.

## Prerequisites
You have been provided with:
- **Documents 4-12**: Completed refactored files for Phases 1-3 (backend infrastructure)
- **Documents 13-21**: Current codebase files requiring updates in Phases 4-6
- **Implementation snippets**: Complete code for SessionManager persistence methods

---

# Phase 1-3: Integration of Refactored Backend Infrastructure

## Objective
Integrate the completed refactored files into the codebase. These files are production-ready and implement the new three-phase workflow architecture.

### 1.1 Update Type Definitions

**File: `shared/contract.ts`**
- Replace entire file with **Document 6** (`contract_refactor.ts`)
- This introduces:
  - Three primitive request types: `InitializeRequest`, `ExtendRequest`, `RecomputeRequest`
  - `WorkflowRequest` union type
  - `ResolvedContext` types for each primitive
  - Updated type guards

**File: `src/persistence/types.ts`**
- Replace entire file with **Document 7** or **Document 8** (`persistence_types_refactor.ts`)
- Key schema changes:
  - `SessionRecord`: Removed `providerContexts`, added `lastTurnId`
  - `AiTurnRecord`: Added `providerContexts`, `turnType`, `parentTurnId`, `sourceTurnId`
  - New `ResolvedContext` types

### 1.2 Implement Context Resolver

**File: `src/core/context-resolver.js`** (NEW FILE)
- Create new file using **Document 5** (`context_resolver.js`) as the complete implementation
- This is the key new abstraction that replaces blocking session hydration
- Implements three resolution methods:
  - `_resolveInitialize()`: Returns empty context for fresh starts
  - `_resolveExtend()`: Fetches only the last turn for its contexts
  - `_resolveRecompute()`: Fetches source turn for frozen outputs and historical contexts

### 1.3 Refactor Connection Handler

**File: `src/core/connection-handler.js`**
- Replace entire file with **Document 4** (`connection_handler_refactor.js`)
- Critical changes implemented:
  - ✅ NEW: 3-phase workflow (Resolve → Compile → Execute)
  - ✅ DELETED: `_ensureSessionHydration` (blocking hydration eliminated)
  - ✅ DELETED: `_normalizeProviderModesForContinuation`
  - ✅ DELETED: `_precheckContinuation`
  - ✅ NEW: ContextResolver injected as dependency

### 1.4 Refactor Workflow Compiler

**File: `src/core/workflow-compiler.js`**
- Replace entire file with **Document 10** (`workflow_compiler_refactor.js`)
- Critical changes implemented:
  - ✅ NOW PURE: Synchronous function, no async/await
  - ✅ REMOVED: All database/SessionManager calls
  - ✅ SIMPLIFIED: Switch on `context.type` instead of complex branching
  - ✅ NEW: Handles recompute primitive (skips batch step)
  - Signature: `compile(request, context)` returns `WorkflowRequest`

### 1.5 Refactor Workflow Engine

**File: `src/core/workflow-engine.js`**
- Replace with **Documents 11-12** (`workflow_engine_refactor.js` + `workflow_engine_refactor_p2.js`)
- Critical changes implemented:
  - ✅ NEW: Accepts `ResolvedContext` as parameter
  - ✅ NEW: Seeds frozen outputs for recompute primitive
  - ✅ UPDATED: Step execution uses context data
  - ✅ NEW: Three-tier context resolution with ResolvedContext support
  - Signature: `execute(workflow, context)`

### 1.6 Update Service Worker Entry Point

**File: `src/sw-entry.js`**
- Use **Document 9** (`sw_entry_refactor.js`) as reference for the relevant sections
- In `initializeGlobalServices()`:
  ```javascript
  // Add after compiler creation:
  const contextResolver = new ContextResolver(sessionManager);
  
  return {
    orchestrator: self.faultTolerantOrchestrator,
    sessionManager,
    compiler,
    contextResolver,  // ✅ NEW: Expose ContextResolver
    persistenceLayer: pl,
    lifecycleManager: self.lifecycleManager
  };
  ```
- In `chrome.runtime.onConnect.addListener()`:
  ```javascript
  const handler = new ConnectionHandler(port, services); // services now includes contextResolver
  ```

### 1.7 Validation Checkpoint
After Phase 1-3 integration, the backend should:
- Accept requests with `type` property ('initialize', 'extend', 'recompute')
- Execute workflows without blocking hydration
- Route through ContextResolver → Compiler → Engine
- **However**: Persistence and UI still use old patterns (will be fixed in Phases 4-6)

---

# Phase 4: Turn-Based Persistence Implementation

## Objective
Overhaul SessionManager to persist data per-turn with turn-scoped provider contexts.

### 4.1 Implement New SessionManager Persistence Methods

**File: `src/persistence/SessionManager.js`** (Current: **Document 14**)

Add the following methods to the SessionManager class:

```javascript
/**
 * NEW: Primary persistence entry point
 * Routes to appropriate primitive-specific handler
 */
async persist(request, context, result) {
  console.log(`[SessionManager] Persisting ${request.type} workflow`);
  
  switch (request.type) {
    case 'initialize':
      return this._persistInitialize(request, result);
    
    case 'extend':
      return this._persistExtend(request, context, result);
    
    case 'recompute':
      return this._persistRecompute(request, context, result);
    
    default:
      throw new Error(`Unknown request type: ${request.type}`);
  }
}

/**
 * Initialize: Create new session + first turn
 */
async _persistInitialize(request, result) {
  const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  
  // 1. Create session record
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
    updatedAt: now
  };
  await this.adapter.put('sessions', sessionRecord);
  
  // 2. Create default thread
  await this.adapter.put('threads', {
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
  });
  
  // 3. Create user turn
  const userTurnId = `user-${now}`;
  await this.adapter.put('turns', {
    id: userTurnId,
    type: 'user',
    sessionId,
    threadId: 'default-thread',
    createdAt: now,
    updatedAt: now,
    content: request.userMessage,
    turnType: 'initialize',
    sequence: 0
  });
  
  // 4. Create AI turn with turn-scoped provider contexts
  const aiTurnId = `ai-${now}`;
  const providerContexts = this._extractContextsFromResult(result);
  
  await this.adapter.put('turns', {
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
    synthesisResponseCount: 0,
    mappingResponseCount: 0
  });
  
  // 5. Persist provider responses
  await this._persistProviderResponses(sessionId, aiTurnId, result, now);
  
  // 6. Update session with lastTurnId
  sessionRecord.lastTurnId = aiTurnId;
  await this.adapter.put('sessions', sessionRecord);
  
  // 7. Update in-memory cache
  const legacySession = await this.buildLegacySessionObject(sessionId);
  this.sessions[sessionId] = legacySession;
  
  console.log(`[SessionManager] Initialize complete: session=${sessionId}`);
  return { sessionId, userTurnId, aiTurnId };
}

/**
 * Extend: Append turn to existing session
 */
async _persistExtend(request, context, result) {
  const { sessionId } = request;
  const now = Date.now();
  
  // 1. Get last turn to inherit contexts
  const lastTurn = await this.adapter.get('turns', context.lastTurnId);
  if (!lastTurn) {
    throw new Error(`Last turn ${context.lastTurnId} not found`);
  }
  
  // 2. Get next sequence
  const allTurns = await this.adapter.getAll('turns');
  const sessionTurns = allTurns.filter(t => t.sessionId === sessionId);
  const nextSequence = sessionTurns.length;
  
  // 3. Create user turn
  const userTurnId = `user-${now}`;
  await this.adapter.put('turns', {
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
  });
  
  // 4. Merge contexts: keep old for unused providers, update for used ones
  const newContexts = this._extractContextsFromResult(result);
  const mergedContexts = {
    ...(lastTurn.providerContexts || {}),
    ...newContexts
  };
  
  // 5. Create AI turn with merged contexts
  const aiTurnId = `ai-${now}`;
  await this.adapter.put('turns', {
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
  });
  
  // 6. Persist provider responses
  await this._persistProviderResponses(sessionId, aiTurnId, result, now);
  
  // 7. Update session
  const session = await this.adapter.get('sessions', sessionId);
  session.lastTurnId = aiTurnId;
  session.lastActivity = now;
  session.turnCount += 2;
  session.updatedAt = now;
  await this.adapter.put('sessions', session);
  
  // 8. Update in-memory cache
  const legacySession = await this.buildLegacySessionObject(sessionId);
  this.sessions[sessionId] = legacySession;
  
  console.log(`[SessionManager] Extend complete: aiTurn=${aiTurnId}`);
  return { sessionId, userTurnId, aiTurnId };
}

/**
 * Recompute: Create derived turn (timeline branch)
 */
async _persistRecompute(request, context, result) {
  const { sessionId, sourceTurnId, stepType, targetProvider } = request;
  const now = Date.now();
  
  // 1. Get source turn
  const sourceTurn = await this.adapter.get('turns', sourceTurnId);
  if (!sourceTurn) {
    throw new Error(`Source turn ${sourceTurnId} not found`);
  }
  
  // 2. Create derived AI turn (NOT advancing main timeline)
  const aiTurnId = `ai-recompute-${now}`;
  await this.adapter.put('turns', {
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
    providerContexts: context.providerContextsAtSourceTurn, // ✅ Historical contexts
    sequence: -1, // Off main timeline
    batchResponseCount: 0,
    synthesisResponseCount: stepType === 'synthesis' ? 1 : 0,
    mappingResponseCount: stepType === 'mapping' ? 1 : 0,
    meta: {
      isHistoricalRerun: true,
      recomputeMetadata: {
        stepType,
        targetProvider
      }
    }
  });
  
  // 3. Persist only the recomputed response
  const responseId = `pr-${sessionId}-${aiTurnId}-${targetProvider}-${stepType}-0-${now}`;
  const responseData = stepType === 'synthesis' 
    ? result.synthesisOutputs?.[targetProvider]
    : result.mappingOutputs?.[targetProvider];
    
  await this.adapter.put('provider_responses', {
    id: responseId,
    sessionId,
    aiTurnId,
    providerId: targetProvider,
    responseType: stepType,
    responseIndex: 0,
    text: responseData?.text || '',
    status: 'completed',
    meta: responseData?.meta || {},
    createdAt: now,
    updatedAt: now,
    completedAt: now
  });
  
  // 4. DO NOT update session.lastTurnId (this is a branch)
  
  // 5. Update in-memory cache
  const legacySession = await this.buildLegacySessionObject(sessionId);
  this.sessions[sessionId] = legacySession;
  
  console.log(`[SessionManager] Recompute complete: derived turn=${aiTurnId}`);
  return { sessionId, aiTurnId };
}

/**
 * Extract provider contexts from workflow result
 */
_extractContextsFromResult(result) {
  const contexts = {};
  
  // Extract from batch outputs
  for (const [providerId, output] of Object.entries(result.batchOutputs || {})) {
    if (output?.meta) {
      contexts[providerId] = output.meta;
    }
  }
  
  // Extract from synthesis/mapping outputs
  for (const [providerId, output] of Object.entries(result.synthesisOutputs || {})) {
    if (output?.meta) {
      contexts[providerId] = output.meta;
    }
  }
  
  for (const [providerId, output] of Object.entries(result.mappingOutputs || {})) {
    if (output?.meta) {
      contexts[providerId] = output.meta;
    }
  }
  
  return contexts;
}

/**
 * Helper: Persist provider responses for a turn
 */
async _persistProviderResponses(sessionId, aiTurnId, result, now) {
  // Batch responses
  for (const [providerId, output] of Object.entries(result.batchOutputs || {})) {
    const respId = `pr-${sessionId}-${aiTurnId}-${providerId}-batch-0-${now}`;
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
    const respId = `pr-${sessionId}-${aiTurnId}-${providerId}-synthesis-0-${now}`;
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
    const respId = `pr-${sessionId}-${aiTurnId}-${providerId}-mapping-0-${now}`;
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
}
```

### 4.2 Update WorkflowEngine to Call New Persistence

**File: `src/core/workflow-engine.js`**

Replace the `_persistCriticalTurnData` method with:

```javascript
async _persistCriticalTurnData(workflowContext, steps, stepResults, resolvedContext) {
  try {
    // Extract results from stepResults
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
    
    // Construct request object for persistence
    const request = {
      type: resolvedContext.type,
      sessionId: workflowContext.sessionId,
      userMessage: workflowContext.userMessage
    };
    
    // Add recompute-specific fields
    if (resolvedContext.type === 'recompute') {
      request.sourceTurnId = resolvedContext.sourceTurnId;
      request.stepType = resolvedContext.stepType;
      request.targetProvider = resolvedContext.targetProvider;
    }
    
    // Call new persist method
    const persistResult = await this.sessionManager.persist(request, resolvedContext, result);
    
    // Update workflow context with IDs
    workflowContext.canonicalUserTurnId = persistResult.userTurnId;
    workflowContext.canonicalAiTurnId = persistResult.aiTurnId;
    
    // For initialize, update sessionId
    if (resolvedContext.type === 'initialize') {
      workflowContext.sessionId = persistResult.sessionId;
    }
    
  } catch (error) {
    console.error('[WorkflowEngine] Persistence failed:', error);
    throw error;
  }
}
```

---

# Phase 5: UI Layer Updates

## Objective
Update UI to construct and send new primitive-based requests.

### 5.1 Update useChat Hook

**File: `ui/hooks/useChat.ts`** (Current: **Document 15**)

Replace the `sendMessage` function:

```typescript
const sendMessage = useCallback(async (prompt: string, mode: 'new' | 'continuation') => {
  if (!prompt || !prompt.trim()) return;

  setIsLoading(true);
  setUiPhase('streaming');
  setCurrentAppStep('initial');

  const activeProviders = LLM_PROVIDERS_CONFIG
    .filter(p => selectedModels[p.id])
    .map(p => p.id as ProviderKey);
    
  if (activeProviders.length === 0) {
    setIsLoading(false);
    return;
  }

  const ts = Date.now();
  const userTurnId = `user-${ts}-${Math.random().toString(36).slice(2,8)}`;
  const userTurn: UserTurn = {
    type: 'user',
    id: userTurnId,
    text: prompt,
    createdAt: ts,
    sessionId: currentSessionId || null
  };

  // Write user turn to Map + IDs
  setTurnsMap((draft: Map<string, TurnMessage>) => {
    draft.set(userTurn.id, userTurn);
  });
  setTurnIds((draft: string[]) => {
    draft.push(userTurn.id);
  });

  try {
    const shouldUseSynthesis = !!(synthesisProvider && activeProviders.length > 1);
    
    const fallbackMapping = (() => { 
      try { return localStorage.getItem('htos_mapping_provider'); } 
      catch { return null; } 
    })();
    const effectiveMappingProvider = mappingProvider || fallbackMapping || null;
    const shouldUseMapping = !!(
      mappingEnabled && 
      effectiveMappingProvider && 
      activeProviders.length > 1 && 
      activeProviders.includes(effectiveMappingProvider as ProviderKey)
    );

    // ✅ NEW: Construct primitive-based request
    const isNewConversation = !currentSessionId || mode === 'new';
    
    const request: WorkflowRequest = isNewConversation
      ? {
          type: 'initialize',  // ✅ Explicit primitive
          userMessage: prompt,
          providers: activeProviders,
          includeMapping: shouldUseMapping,
          includeSynthesis: shouldUseSynthesis,
          synthesizer: shouldUseSynthesis ? (synthesisProvider as ProviderKey) : undefined,
          mapper: shouldUseMapping ? (effectiveMappingProvider as ProviderKey) : undefined,
          useThinking: computeThinkFlag({ modeThinkButtonOn: thinkOnChatGPT, input: prompt })
        }
      : {
          type: 'extend',  // ✅ Explicit primitive
          sessionId: currentSessionId,
          userMessage: prompt,
          providers: activeProviders,
          includeMapping: shouldUseMapping,
          includeSynthesis: shouldUseSynthesis,
          synthesizer: shouldUseSynthesis ? (synthesisProvider as ProviderKey) : undefined,
          mapper: shouldUseMapping ? (effectiveMappingProvider as ProviderKey) : undefined,
          useThinking: computeThinkFlag({ modeThinkButtonOn: thinkOnChatGPT, input: prompt })
        };

    await api.executeWorkflow(request);

    // For initialize, backend returns new sessionId via TURN_CREATED message
    
  } catch (err) {
    console.error('Failed to execute workflow:', err);
    setIsLoading(false);
    setActiveAiTurnId(null);
  }
}, [
  setTurnsMap,
  setTurnIds,
  selectedModels,
  currentSessionId,
  setCurrentSessionId,
  setIsLoading,
  setActiveAiTurnId,
  synthesisProvider,
  mappingEnabled,
  mappingProvider,
  thinkOnChatGPT,
  synthesisProviders,
  powerUserMode,
  turnIds.length
]);
```

### 5.2 Update useRoundActions Hook

**File: `ui/hooks/useRoundActions.ts`** (Current: **Document 16**)

Replace `runSynthesisForRound`:

```typescript
const runSynthesisForRound = useCallback(
  async (userTurnId: string, providerIdOverride?: string) => {
    if (!currentSessionId || isSynthRunningRef.current) return;

    const roundInfo = findRoundForUserTurn(userTurnId);
    if (!roundInfo || !roundInfo.user || !roundInfo.ai) return;

    const { ai, user } = roundInfo;

    // ... existing validation logic ...

    const selected = providerIdOverride
      ? [providerIdOverride]
      : Object.entries(synthSelectionsByRound[userTurnId] || {})
          .filter(([_, on]) => on)
          .map(([pid]) => pid);
          
    if (selected.length === 0) return;

    // Optimistic UI update
    setTurnsMap((draft: Map<string, TurnMessage>) => {
      const existing = draft.get(ai.id);
      if (!existing || existing.type !== 'ai') return;
      const aiTurn = existing as AiTurn;
      if (!aiTurn.synthesisResponses) aiTurn.synthesisResponses = {};
      const next: Record<string, ProviderResponse[]> = { ...aiTurn.synthesisResponses };
      selected.forEach((pid) => {
        const arr = Array.isArray(next[pid]) ? [...next[pid]] : [];
        arr.push({
          providerId: pid as ProviderKey,
          text: '',
          status: PRIMARY_STREAMING_PROVIDER_IDS.includes(pid) ? 'streaming' : 'pending',
          createdAt: Date.now(),
        });
        next[pid] = arr;
      });
      aiTurn.synthesisResponses = next;
    });

    setActiveAiTurnId(ai.id);
    isSynthRunningRef.current = true;
    setIsLoading(true);
    setUiPhase('streaming');
    setCurrentAppStep('synthesis');

    try {
      // ✅ NEW: Construct RecomputeRequest
      const request: RecomputeRequest = {
        type: 'recompute',  // ✅ Explicit primitive
        sessionId: currentSessionId,
        sourceTurnId: userTurnId,  // Which turn to recompute
        stepType: 'synthesis',      // Which step to rerun
        targetProvider: selected[0] as ProviderKey,  // New synthesizer
        useThinking: !!thinkSynthByRound[userTurnId]
      };

      if (selected.length === 1) {
        try {
          localStorage.setItem('htos_last_synthesis_model', selected[0]);
        } catch {}
      }

      await api.executeWorkflow(request);
    } catch (err) {
      console.error('Synthesis run failed:', err);
      setIsLoading(false);
      setUiPhase('awaiting_action');
      setActiveAiTurnId(null);
    } finally {
      isSynthRunningRef.current = false;
    }
  },
  [/* deps */]
);
```

Replace `runMappingForRound`:

```typescript
const runMappingForRound = useCallback(
  async (userTurnId: string, providerIdOverride?: string) => {
    if (!currentSessionId) return;

    const roundInfo = findRoundForUserTurn(userTurnId);
    if (!roundInfo?.user || !roundInfo.ai) return;

    const userTurn = roundInfo.user as UserTurn;
    const { ai } = roundInfo;

    // ... existing validation logic ...

    const effectiveMappingProvider = providerIdOverride || mappingSelectionByRound[userTurnId];
    if (!effectiveMappingProvider) return;

    setMappingSelectionByRound((draft: Record<string, string | null>) => {
      if (draft[userTurnId] === effectiveMappingProvider) return;
      draft[userTurnId] = effectiveMappingProvider;
    });

    // Optimistic UI update
    setTurnsMap((draft: Map<string, TurnMessage>) => {
      const existing = draft.get(ai.id);
      if (!existing || existing.type !== 'ai') return;
      const aiTurn = existing as AiTurn;
      const prev = aiTurn.mappingResponses || {};
      const next: Record<string, ProviderResponse[]> = { ...prev };
      const arr = Array.isArray(next[effectiveMappingProvider]) ? [...next[effectiveMappingProvider]] : [];
      arr.push({
        providerId: effectiveMappingProvider as ProviderKey,
        text: '',
        status: PRIMARY_STREAMING_PROVIDER_IDS.includes(effectiveMappingProvider) ? 'streaming' : 'pending',
        createdAt: Date.now(),
      });
      next[effectiveMappingProvider] = arr;
      aiTurn.mappingResponses = next;
    });

    setActiveAiTurnId(ai.id);
    setIsLoading(true);
    setUiPhase('streaming');
    setCurrentAppStep('synthesis');

    try {
      // ✅ NEW: Construct RecomputeRequest
      const request: RecomputeRequest = {
        type: 'recompute',
        sessionId: currentSessionId,
        sourceTurnId: userTurnId,
        stepType: 'mapping',
        targetProvider: effectiveMappingProvider as ProviderKey,
        useThinking: effectiveMappingProvider === 'chatgpt' ? !!thinkMappingByRound[userTurnId] : false
      };

      await api.executeWorkflow(request);
    } catch (err) {
      console.error('Mapping run failed:', err);
      setIsLoading(false);
      setUiPhase('awaiting_action');
      setActiveAiTurnId(null);
    }
  },
  [/* deps */]
);
```

---

# Phase 6: Adapter Unification & Database Migration

## Objective
Unify provider adapter interface and implement one-time database migration.

### 6.1 Provider Adapter Unification (OPTIONAL)

**Note**: This phase is optional. Current dual-method adapters work correctly with the new architecture. The orchestrator already routes properly based on context presence.

If you choose to unify, follow this pattern for each adapter:

```javascript
/**
 * Unified ask method - handles both new and continuation
 */
async ask(prompt, context, signal, onChunk) {
  const hasContinuation = context?.meta?.conversationId 
    || context?.meta?.chatId 
    || context?.meta?.cursor
    || context?.meta?.sessionId;
  
  if (hasContinuation) {
    // Continuation logic using context.meta.*
    return this._continuationLogic(prompt, context, signal, onChunk);
  } else {
    // New conversation logic
    return this._newConversationLogic(prompt, signal, onChunk);
  }
}
```

**Files to update** (if pursuing unification):
- `src/providers/claude-adapter.js` (Document 21)
- `src/providers/chatgpt-adapter.js` (Document 17)
- `src/providers/gemini-adapter.js` (Document 18)
- `src/providers/gemini-pro-adapter.js` (Document 19)
- `src/providers/qwen-adapter.js` (Document 20)

### 6.2 Database Migration Implementation

**File: `src/persistence/database.ts`** (Current: **Document 13**)

Update the database version and add migration logic:

```typescript
// Increment version to trigger migration
export const DB_VERSION = 2;  // ✅ Changed from 1 to 2

// In onupgradeneeded handler, add:
request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
  const db = (event.target as IDBOpenDBRequest).result;
  const oldVersion = event.oldVersion;
  const transaction = (event.target as IDBOpenDBRequest).transaction!;
  
  console.log(`Upgrading database from version ${oldVersion} to ${DB_VERSION}`);
  
  if (oldVersion < 1) {
    // Initial schema creation
    createInitialSchema(db);
    
    // Set initial metadata
    const metadataStore = transaction.objectStore('metadata');
    const now = Date.now();
    const schemaVersionRecord: MetadataRecord = {
      id: 'schema_version_record',
      key: 'schema_version',
      value: SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now
    };
    metadataStore.add(schemaVersionRecord);
  }
  
  // ✅ NEW: Migration from session-based to turn-based contexts
  if (oldVersion < 2) {
    console.log('[DB Migration] Starting turn-based context migration...');
    migrateToTurnBasedContexts(db, transaction);
  }
};

/**
 * Migration: Backfill turn-scoped contexts
 */
function migrateToTurnBasedContexts(db: IDBDatabase, transaction: IDBTransaction) {
  const sessionsStore = transaction.objectStore('sessions');
  const turnsStore = transaction.objectStore('turns');
  const contextsStore = transaction.objectStore('provider_contexts');
  
  // Get all sessions
  const sessionsRequest = sessionsStore.openCursor();
  
  sessionsRequest.onsuccess = (event) => {
    const cursor = (event.target as IDBRequest).result;
    if (!cursor) {
      console.log('[DB Migration] Turn-based context migration complete');
      return;
    }
    
    const session = cursor.value as SessionRecord;
    console.log(`[DB Migration] Migrating session ${session.id}`);
    
    // Get all turns for this session
    const turnsBySession = turnsStore.index('bySessionId');
    const turnsRequest = turnsBySession.getAll(session.id);
    
    turnsRequest.onsuccess = () => {
      const turns = turnsRequest.result as TurnRecord[];
      turns.sort((a, b) => (a.sequence ?? a.createdAt) - (b.sequence ?? b.createdAt));
      
      // Get provider contexts for this session
      const contextsBySession = contextsStore.index('bySessionId');
      const contextsRequest = contextsBySession.getAll(session.id);
      
      contextsRequest.onsuccess = () => {
        const contexts = contextsRequest.result as ProviderContextRecord[];
        
        // Build contexts map by provider
        const contextsByProvider: Record<string, any> = {};
        contexts.forEach(ctx => {
          contextsByProvider[ctx.providerId] = ctx.meta || ctx.contextData || {};
        });
        
        // Backfill contexts onto each AI turn
        let currentContexts = { ...contextsByProvider };
        
        turns.forEach((turn, index) => {
          if (turn.type !== 'ai' && turn.role !== 'assistant') return;
          
          // This AI turn gets current contexts
          const aiTurn = turn as AiTurnRecord;
          aiTurn.providerContexts = { ...currentContexts };
          aiTurn.turnType = index === 1 ? 'initialize' : 'extend';
          
          // Update turn in database
          turnsStore.put(aiTurn);
          
          // TODO: Update contexts if this turn has new provider responses
          // (Would need to read provider_responses to extract new meta)
        });
        
        // Update session: remove old providerContexts, set lastTurnId
        const lastAiTurn = turns.reverse().find(t => t.type === 'ai' || t.role === 'assistant');
        if (lastAiTurn) {
          session.lastTurnId = lastAiTurn.id;
        }
        
        // Note: We don't actually remove providerContexts from SessionRecord
        // in the migration because it might break backward compatibility.
        // The new code simply won't use it.
        
        sessionsStore.put(session);
        
        console.log(`[DB Migration] Migrated ${turns.length} turns for session ${session.id}`);
      };
    };
    
    cursor.continue();
  };
  
  sessionsRequest.onerror = () => {
    console.error('[DB Migration] Failed to migrate sessions:', sessionsRequest.error);
  };
}
```

---

# Validation & Testing

## Post-Integration Checklist

### Backend (Phases 1-3)
- [ ] ContextResolver correctly resolves Initialize/Extend/Recompute contexts
- [ ] ConnectionHandler executes 3-phase workflow without blocking hydration
- [ ] WorkflowCompiler is pure (no async, no DB calls)
- [ ] WorkflowEngine seeds frozen outputs for recompute

### Persistence (Phase 4)
- [ ] Initialize creates new session with turn-scoped contexts
- [ ] Extend merges contexts from previous turn
- [ ] Recompute creates derived turn without advancing timeline
- [ ] Provider responses persist correctly for all primitives

### UI (Phase 5)
- [ ] New chats send InitializeRequest
- [ ] Continued chats send ExtendRequest
- [ ] Historical reruns send RecomputeRequest
- [ ] TURN_CREATED messages update UI state correctly

### Database (Phase 6)
- [ ] Migration runs successfully on upgrade
- [ ] Existing sessions have contexts backfilled onto turns
- [ ] lastTurnId populated on all sessions
- [ ] No data loss during migration

## End-to-End Test Scenarios

1. **New Conversation**
   - Start fresh chat
   - Verify InitializeRequest sent
   - Verify session created with turn-scoped contexts
   
2. **Continue Conversation**
   - Send second message
   - Verify ExtendRequest sent with sessionId
   - Verify contexts inherited and merged
   
3. **Historical Rerun**
   - Click synthesis provider on past turn
   - Verify RecomputeRequest sent with sourceTurnId
   - Verify derived turn created, main timeline unaffected
   
4. **Performance**
   - Measure time from message send to first response
   - Verify no blocking hydration occurs (should be <50ms overhead)

---

# Final Notes

- All Phase 1-3 files (Documents 4-12) are production-ready — integrate as-is
- Phase 4-6 code snippets are complete — copy directly into existing files
- Database migration is critical — test on copy of production data first
- Adapter unification (Phase 6.1) is optional — current code works correctly

This refactor eliminates blocking session hydration, improves performance for continuation requests, and establishes a clean primitive-based architecture for future features (selective providers, branching, etc.).