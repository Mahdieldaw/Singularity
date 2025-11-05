Architecture Corrections and Integration Directives v2 — Turn-Based Context Refactor

Summary

- The proposed architecture is sound and fixes the blocking session hydration bottleneck.
- Adopt a clean break for request types and move provider contexts from session scope to turn scope.
- Integrate the implied SessionManager orchestration from the Proposed architecture and close the identified gaps before surgical edits.

Decisions and Guardrails

- Use type: 'initialize' | 'extend' | 'recompute' with no userTurnId on inbound requests (Option A: Clean Break).
- Rename conflicting types:
  - WorkflowExecutionRequest: union of InitializeRequest | ExtendRequest | RecomputeRequest.
  - CompiledWorkflow: the compiled steps emitted by the compiler.


Corrections and Concrete Actions

1) Request Type Mismatch

- shared/contract.ts
  - Replace ExecuteWorkflowRequest and mode with WorkflowExecutionRequest union and type guards.
  - Remove any requirement for userTurnId on inbound workflow requests.
- UI (useChat.ts)
  - Build primitive requests with type ('initialize', 'extend', 'recompute').
  - Do not generate userTurnId; IDs are returned by persist().
- ConnectionHandler
  - Remove validation requiring userTurnId.

2) Context Storage Location

- SessionManager: migrate session-level contexts to AI turns.
  - Add _migrateContextsToTurns(sessionId): move session.providers → latest AI turn.providerContexts.
  - Update getProviderContexts() to read from latest AI turn (not session).
  - Update buildLegacySessionObject() to read providerContexts from latest AI turn.
  - Stop writing to session.providers in updateProviderContextWithPersistence().

Example migration helper (pseudocode):

```
async _migrateContextsToTurns(sessionId) {
  const session = await this.getOrCreateSession(sessionId);
  const lastAiTurn = await this._getLastAiTurn(sessionId);
  if (!lastAiTurn || !session?.providers) return;
  lastAiTurn.providerContexts = { ...session.providers };
  await this.adapter.put('turns', lastAiTurn);
  // Optionally clear session.providers after verifying reads use turn-scoped contexts.
}
```

3) WorkflowCompiler Context Access

- Update compile signature to compile(request, resolvedContext) and use resolvedContext.providerContexts for extend.
- Remove calls to sessionManager.getProviderContexts() inside compiler.

4) Recompute Frozen Output Retrieval

- ContextResolver must fetch frozen batch outputs from provider_responses store by aiTurnId and responseType === 'batch'.
- Ensure shape aligns with engine seeding logic.

Example (pseudocode):

```
async _extractFrozenBatchOutputs(aiTurnId) {
  const all = await this.adapter.getAll('provider_responses');
  const batch = all.filter(r => r.aiTurnId === aiTurnId && r.responseType === 'batch');
  const frozen = {};
  for (const r of batch) frozen[r.providerId] = { text: r.text, meta: r.meta, status: r.status };
  return frozen;
}
```

5) Persistence Orchestration

- Add SessionManager.persist(request, resolvedContext, result) → route to _persistInitialize/_persistExtend/_persistRecompute.
- Implement:
  - _extractContextsFromResult(result): meta collection per provider.
  - _persistProviderResponses(sessionId, aiTurnId, result, now): append-only writes per provider.
- Initialize: create session + default thread; write user turn (0) and AI turn (1); update lastTurnId.
- Extend: read lastTurnId + contexts from latest AI turn; write new user turn + merged AI turn; update lastTurnId.
- Recompute: write derived AI turn (sequence -1) linked to sourceTurnId; persist only targeted response; do not change lastTurnId.
- Emit TURN_CREATED and TURN_FINALIZED with IDs and outputs.

6) IndexedDB Migration

- src/persistence/database.ts
  - Increment DB_VERSION conservatively (e.g., 2).
  - In onupgradeneeded:
    - Backfill session.providers → latest AI turn.providerContexts.
    - Add fields: SessionRecord.lastTurnId; AI turn providerContexts, turnType, parentTurnId, sourceTurnId, sequence.
  - Keep store names unchanged; update records in place; idempotent.

7) Service Worker Entry and Wiring

- src/sw-entry.js
  - initializeGlobalServices(): instantiate ContextResolver(sessionManager) and register DNR rules synchronously.
  - chrome.runtime.onConnect.addListener(): inject services (including contextResolver) into ConnectionHandler.
  - Offscreen bootstrap enforces singleton.

8) UI Layer Updates

- ui/state/atoms.ts: remove providerContextsAtom.
- ui/hooks/useChat.ts: build primitive WorkflowExecutionRequest; no userTurnId.
- ui/hooks/useRoundActions.ts: build recompute request with sourceTurnId, stepType, targetProvider.
- ui/hooks/usePortMessageHandler.ts: consume TURN_CREATED and TURN_FINALIZED; store turn-scoped contexts.

Observability and Security

- Append-only logs:
  - [ConnectionHandler] Resolved context type=…
  - [Compiler] Built steps=…
  - [Engine] Executed steps=… status=…
  - [SessionManager] Persist type=… aiTurnId=… lastTurnId=…
- Security override: stop immediately if any token/cookie crosses the content script boundary.

Implementation Order (Phased)

- Phase 1: Type system migration (blocks everything else).
- Phase 2: Context migration (enables ContextResolver).
- Phase 3: ContextResolver integration + compiler signature update.
- Phase 4: Persistence refactor and engine wiring.
- Phase 5: Service worker and UI updates.




Done Criteria

- UI sends initialize/extend/recompute primitives; no userTurnId.
- Resolve → Compile → Execute pathway runs without session-wide hydration.
- Turn-scoped contexts stored on AI turns; lastTurnId advances only on initialize/extend.
- TURN_CREATED and TURN_FINALIZED drive UI updates; recompute creates derived AI turn without advancing timeline.
- DNR rules active at startup; offscreen singleton stable.
- Observed performance improvement on extend due to minimal reads and no blocking hydration.