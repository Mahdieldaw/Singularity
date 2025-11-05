Agent Execution Prompt: Turn‑Based Workflow Refactor v2 (Initialize, Extend, Recompute) — Full Scope and Integration Plan

Purpose and Scope

- Transition from session‑scoped mutable context to turn‑scoped immutable context using three primitives:
  - initialize: new conversation with user message
  - extend: continuation on the active timeline, inheriting last turn’s contexts only
  - recompute: targeted rerun on a historical turn; does not advance timeline
- Preserve existing business logic and behaviors while refactoring control flow and data placement.
- Treat /work2 files as architectural references and templates, not drop‑in replacements.
- Deliver a working integration into the current codebase once the foundational layer (types + persistence) is settled.



Reference Materials (Use as References Only)

- /work2/connection_handler_refactor.js — flow template for Resolve → Compile → Execute
- /work2/context_resolver.js — ContextResolver implementation for initialize/extend/recompute
- /work2/workflow_compiler_refactor.js — pure synchronous compiler shape
- /work2/workflow_engine_refactor.js and _p2.js — engine execution with ResolvedContext and recompute seeding
- /work2/contract_refactor.ts — types: InitializeRequest, ExtendRequest, RecomputeRequest, ResolvedContext
- /work2/persistence_types_refactor.ts and …2.ts — turn‑based schema examples
- /work2/sw_entry_refactor.js — service worker wiring and DNR registration patterns

Preflight: Observe Before Edit

- Security pass: ensure no credentials/secrets leak in content scripts or logs.
- Startup truth check:
  - Launch the extension and capture service worker logs.
  - Reproduce and then eliminate the error: [Backend] Missing userTurnId in request.
  - Confirm DNR rules register synchronously at service worker init; no fallback to webRequest.

Foundational Layer Decisions (Adopt Clean Break)

- Request Types: Use type union with no userTurnId on inbound requests.
  - type: 'initialize' | 'extend' | 'recompute'.
  - Replace legacy ExecuteWorkflowRequest and mode fields.
- Type naming: Avoid collision between WorkflowRequest (UI→backend primitive) and compiled workflow.
  - Use WorkflowExecutionRequest for the union types.
  - Use CompiledWorkflow for the compiled steps.

Surgical Implementation Plan and Postconditions (by file)

1) Types and Contracts

- shared/contract.ts
  - Integrate types from contract_refactor.ts:
    - InitializeRequest, ExtendRequest, RecomputeRequest, WorkflowExecutionRequest union, ResolvedContext variants.
  - Add type guards for request.type ('initialize' | 'extend' | 'recompute').
  - Remove any requirement for userTurnId on inbound workflow requests.
  - Postconditions:
    - No references to legacy ExecuteWorkflowRequest.
    - Port message validators accept primitive requests without userTurnId.

2) Persistence Schema and Types

- src/persistence/types.ts
  - Adopt turn‑based schema:
    - SessionRecord: remove providerContexts; add lastTurnId.
    - AiTurnRecord: add providerContexts, turnType ('initialize' | 'extend' | 'recompute'), parentTurnId, sourceTurnId, sequence.
  - Ensure enums or constants for turnType are available.
  - Postconditions:
    - Provider contexts live per AI turn, not session.
    - lastTurnId advances only on initialize/extend.

3) ContextResolver (new abstraction)

- src/core/context-resolver.js (new file)
  - Implement ContextResolver using /work2/context_resolver.js as a template:
    - resolve(request):
      - initialize: return empty ResolvedContextInitialize.
      - extend: fetch only the latest AI turn; return ResolvedContextExtend with lastTurnId and filtered providerContexts.
      - recompute: fetch the source AI turn; seed providerContextsAtSourceTurn and frozen outputs from provider_responses.
  - Constraints:
    - No network logic; minimal IndexedDB reads only (latest turn or source turn).
    - No session‑wide hydration.

4) Connection Handler (orchestrate Resolve → Compile → Execute)

- src/core/connection-handler.js
  - Inject contextResolver via constructor.
  - Message handling for execute workflow:
    - const resolved = await contextResolver.resolve(request)
    - const compiled = compiler.compile(request, resolved)
    - const result = await engine.execute(compiled, resolved)
  - Remove legacy _ensureSessionHydration and any validation requiring userTurnId on inbound requests.
  - Preserve handling of KEEPALIVE_PING, abort, and other existing message types.
  - Postconditions:
    - initialize/extend: begin execution with only the latest needed state.
    - recompute: seed engine from frozen outputs; does not advance timeline.

5) Workflow Compiler (pure synchronous)

- src/core/workflow-compiler.js
  - Signature: compile(request, resolvedContext) — no async and no SessionManager calls.
  - Switch by resolvedContext.type:
    - initialize/extend: prompt step; optionally synthesis/mapping based on flags.
    - recompute: targeted single step; skip batch when seeding frozen outputs.
  - Use providerContexts from resolvedContext for extend only.
  - Postconditions:
    - Deterministic, pure compiler.
    - Payloads reflect includeSynthesis/includeMapping, synthesizer, mapper, provider sets.

6) Workflow Engine (execute with ResolvedContext)

- src/core/workflow-engine.js
  - execute(compiled, resolvedContext):
    - For recompute: seed stepResults from resolvedContext.frozenBatchOutputs; execute only the requested step.
    - Build result: batchOutputs, synthesisOutputs, mappingOutputs, meta per provider.
    - Persist via SessionManager.persist(requestForPersistence, resolvedContext, result).
      - requestForPersistence fields: type, sessionId, userMessage; for recompute include sourceTurnId, stepType, targetProvider.
    - Emit TURN_CREATED and TURN_FINALIZED after persist.
  - Postconditions:
    - IDs generated during persist; no inbound userTurnId.
    - Recompute does not update session.lastTurnId.

7) SessionManager orchestration (single entrypoint)

- src/persistence/SessionManager.js
  - Add persist(request, resolvedContext, result): routes to:
    - _persistInitialize(request, result)
    - _persistExtend(request, resolvedContext, result)
    - _persistRecompute(request, resolvedContext, result)
  - Implement helpers:
    - _extractContextsFromResult(result): collect meta per provider across outputs.
    - _persistProviderResponses(sessionId, aiTurnId, result, now): append‑only writes per provider and response type.
  - Initialize:
    - Create session and default thread; write user turn (sequence 0) and AI turn (sequence 1) with providerContexts from result meta.
    - Update sessions.lastTurnId to AI turn; increment turnCount.
  - Extend:
    - Read lastTurnId and providerContexts from latest AI turn.
    - Create new user turn; merge contexts for AI turn (preserve providers not used; update those with outputs).
    - Update sessions.lastTurnId; append provider_responses.
  - Recompute:
    - Create derived AI turn off timeline (sequence -1) with historical contexts; persist only recomputed response.
    - Do not advance sessions.lastTurnId.
  - buildLegacySessionObject(sessionId):
    - Read providerContexts from latest AI turn, not SessionRecord.
  - Migration helper:
    - _migrateContextsToTurns(sessionId): move session.providers → latest AI turn.providerContexts; then stop using session-level contexts.
  - Postconditions:
    - Canonical userTurnId and aiTurnId returned to engine.
    - In‑memory sessions cache coherent; no dependence on session.providerContexts.

8) IndexedDB migration (version bump only)

- src/persistence/database.ts
  - Increment DB_VERSION conservatively (e.g., 2) and use onupgradeneeded to:
    - Backfill session-level contexts into latest AI turn(s).
    - Add missing fields: SessionRecord.lastTurnId; AI turn fields (providerContexts, turnType, parentTurnId, sourceTurnId, sequence).
  - Keep store names unchanged; update records in place.
  - Postconditions: idempotent, safe migration with no data loss.

9) Service Worker entry and wiring

- src/sw-entry.js
  - initializeGlobalServices(): instantiate ContextResolver(sessionManager); register DNR synchronously.
  - chrome.runtime.onConnect.addListener(): inject services (including contextResolver) into ConnectionHandler.
  - Maintain offscreen singleton (ping → recreate on failure).
  - Gradual HTOS → htos migration via safe aliasing; plan final directory rename after imports updated.

10) UI layer updates

- ui/state/atoms.ts: remove providerContextsAtom.
- ui/hooks/useChat.ts: construct WorkflowExecutionRequest primitive:
  - initialize when starting new chat.
  - extend when continuing (requires sessionId).
  - includeSynthesis/includeMapping flags; synthesizer/mapper selection.
  - Do not attach userTurnId.
- ui/hooks/useRoundActions.ts: build recompute request:
  - type: 'recompute', sessionId, sourceTurnId, stepType ('synthesis' | 'mapping'), targetProvider.
- ui/hooks/usePortMessageHandler.ts:
  - Remove mutations of providerContextsAtom.
  - On TURN_CREATED: insert user/ai turns with returned IDs.
  - On TURN_FINALIZED: update turns with outputs and turn-scoped contexts.

Message Protocol and Event Payloads

- Incoming request from UI: WorkflowExecutionRequest with type initialize | extend | recompute. No userTurnId.
- Engine emits:
  - TURN_CREATED: sessionId (new on initialize), userTurnId, aiTurnId, turnType.
  - TURN_FINALIZED: aiTurnId, batchOutputs, synthesisOutputs, mappingOutputs, providerContexts (turn-scoped), metadata.

Fixing “Missing userTurnId in request”

- Remove any validation that requires userTurnId on inbound messages (connection-handler or lifecycle validator).
- Ensure workflow-engine persists without a userTurnId; persist() returns canonical IDs.
- Verify logs: error disappears; TURN_CREATED carries generated userTurnId.

Observability and Truth Maintenance

- Append-only logs:
  - [ConnectionHandler] Resolved context type=…
  - [Compiler] Built workflow steps=…
  - [Engine] Executed steps=… status=…
  - [SessionManager] Persisting type=… aiTurnId=… lastTurnId=…
- Security override: if any token/cookie crosses content script boundary, halt and fix first.

Acceptance Tests (manual)

- New chat: expect TURN_CREATED + TURN_FINALIZED; sessions.lastTurnId equals latest AI turn; user→ai sequence 0,1.
- Extend: contexts merged; providerContexts stored on new AI turn; session.turnCount increments by 2; lastTurnId advances.
- Recompute: derived AI turn with sequence -1 and sourceTurnId set; only recomputed response persisted; lastTurnId unchanged.

- Maintain DNR and Offscreen behaviors unchanged.

Risk Controls

- Prefer additive changes
- Minimize surface area per commit; verify logs and IndexedDB state after each change.
- If emergent behavior deviates but is safe, document it; revert only when security or contracts break.

Deliverables

- Updated diffs for:
  - shared/contract.ts
  - src/persistence/types.ts
  - src/core/context-resolver.js (new)
  - src/core/connection-handler.js
  - src/core/workflow-compiler.js
  - src/core/workflow-engine.js
  - src/sw-entry.js
  - src/persistence/SessionManager.js
  - src/persistence/database.ts
  - ui/state/atoms.ts
  - ui/hooks/useChat.ts
  - ui/hooks/useRoundActions.ts
  - ui/hooks/usePortMessageHandler.ts
- Verified logs and UI behaviors matching acceptance tests.
- No “Missing userTurnId in request” errors; TURN_CREATED/TURN_FINALIZED flow stable.

Notes to Agent

- Use /work2 files strictly as references and control-flow templates.
- Port existing payload construction and error handling into the new structure.
- DeclarativeNetRequest only; no webRequest.
- Respect Code Is Truth: run, observe, then modify. Security overrides everything.