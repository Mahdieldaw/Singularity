Below is a concise architectural blueprint that explains how the system will function end‑to‑end, with emphasis on orchestration for initialize, extend, and recompute, and how persistence/data storage is shaped for efficiency.

System Overview

- Goal: Move from session‑scoped mutable context to turn‑scoped immutable context using three explicit primitives.
- Primitives:
  - initialize: start a new timeline with a fresh user message.
  - extend: continue the active timeline, inheriting only the last turn’s provider contexts.
  - recompute: build a derived result from a historical turn without advancing the main timeline.
Core Components and Responsibilities

- Service Worker (sw-entry.js)
  
  - Bootstraps all services synchronously.
  - Registers declarativeNetRequest rules at init (no webRequest or async fallback).
  - Creates instances of SessionManager, ContextResolver, WorkflowCompiler, WorkflowEngine.
  - Injects services into ConnectionHandler on chrome.runtime.onConnect.
  - Ensures singleton offscreen document: ping → recreate on failure.
- ConnectionHandler (src/core/connection-handler.js)
  
  - Receives UI requests and orchestrates the flow:
    - Resolve → Compile → Execute.
  - Emits TURN_CREATED and TURN_FINALIZED messages for the UI.
  - Does not require userTurnId on inbound requests; IDs are generated during persistence.
  - Preserves existing non‑workflow message handling (keepalive, abort, etc.).
- ContextResolver (src/core/context-resolver.js)
  
  - Resolves exactly the data needed for the primitive:
    - initialize: returns an empty ResolvedContextInitialize.
    - extend: fetches only the last turn; returns ResolvedContextExtend with lastTurnId and providerContexts from the latest AI turn.
    - recompute: fetches source turn; returns ResolvedContextRecompute with historical contexts and any frozen outputs required to seed the engine.
- WorkflowCompiler (src/core/workflow-compiler.js)
  
  - Pure synchronous function: compile(request, resolvedContext) → workflow steps.
  - Switches on resolvedContext.type:
    - initialize/extend: prompt step + optional synthesis/mapping steps.
    - recompute: includes only the targeted recompute step and skips batch if seeding frozen outputs.
- WorkflowEngine (src/core/workflow-engine.js)
  
  - Executes steps using resolvedContext.
  - For recompute: seeds with frozen outputs and runs only the requested step.
  - Produces a result object:
    - batchOutputs: { providerId → output }
    - synthesisOutputs: { providerId → output }
    - mappingOutputs: { providerId → output }
  - Calls SessionManager.persist(requestForPersistence, resolvedContext, result).
  - Emits TURN_CREATED and TURN_FINALIZED after persistence.
- SessionManager (src/persistence/SessionManager.js)
  
  - Orchestrates turn‑based persistence via a single entry point:
    - persist(request, resolvedContext, result) routes to _persistInitialize/_persistExtend/_persistRecompute.
  - Maintains an in‑memory sessions cache for fast UI history loading.
  - Ensures canonical userTurnId and aiTurnId generation; returns them to WorkflowEngine.
- IndexedDB Adapter and Stores (src/persistence/**)
  
  - Object stores:
    - sessions: { id, lastTurnId, turnCount, lastActivity, … }
    - threads: per‑session thread(s), default thread created on initialize.
    - turns: each user or AI turn with type, sequence, parent/source relationships.
    - provider_responses: append‑only entries per AI turn and provider per step type.
  - Contexts location:
    - SessionRecord has no providerContexts.
    - AiTurnRecord holds providerContexts: { providerId → meta } for that turn only.
  - Migration:
    - Version bump migrates any legacy session‑level contexts into the latest AI turn(s).
    - Appends missing fields (lastTurnId, turnType, parentTurnId, sourceTurnId).
End‑to‑End Orchestration Flows

Initialize (new conversation)

- UI sends WorkflowRequest:
  - type: 'initialize'
  - userMessage
  - providers, includeSynthesis/includeMapping, synthesizer/mapper, useThinking
- ConnectionHandler:
  - resolved = ContextResolver.resolve(request) → empty context
  - workflow = Compiler.compile(request, resolved) → prompt (+ optional synthesis/mapping)
  - result = Engine.execute(workflow, resolved)
  - persistResult = SessionManager.persist(request, resolved, result)
    - Creates session, default thread
    - Writes user turn (sequence 0) and AI turn (sequence 1)
    - Provider contexts captured on AI turn from result.meta
    - Writes provider_responses
    - Updates sessions.lastTurnId to AI turn
  - Emits:
    - TURN_CREATED: sessionId, userTurnId, aiTurnId, turnType='initialize'
    - TURN_FINALIZED: aiTurnId + outputs + providerContexts
- UI:
  - Sets new sessionId and updates history panel and turn list.
Extend (continue current session on main timeline)

- UI sends WorkflowRequest:
  - type: 'extend'
  - sessionId
  - userMessage, flags, providers
- ConnectionHandler:
  - resolved = ContextResolver.resolve(request)
    - Reads session.lastTurnId and fetches the latest AI turn
    - Provides lastTurnId + providerContexts for inheritance
  - workflow = Compiler.compile(request, resolved)
    - Includes prompt + optional synthesis/mapping steps
  - result = Engine.execute(workflow, resolved)
  - persistResult = SessionManager.persist(request, resolved, result)
    - Computes next sequence index
    - Writes user turn (parentTurnId = lastTurnId)
    - Merges contexts:
      - Keep prior contexts for providers not used in this step
      - Update contexts for providers that produced outputs in this turn
    - Writes AI turn with merged providerContexts; updates sessions.lastTurnId
    - Writes provider_responses
  - Emits:
    - TURN_CREATED: userTurnId, aiTurnId, turnType='extend'
    - TURN_FINALIZED: outputs + merged providerContexts
- UI:
  - Updates turn list; no userTurnId required on the request (IDs are generated and returned).
Recompute (derived result on historical turn; does not advance main timeline)

- UI sends WorkflowRequest:
  - type: 'recompute'
  - sessionId, sourceTurnId
  - stepType: 'mapping' | 'synthesis'
  - targetProvider
- ConnectionHandler:
  - resolved = ContextResolver.resolve(request)
    - Fetches the source AI turn and its providerContexts
    - Seeds frozen outputs relevant to the recompute target (optional prefill)
  - workflow = Compiler.compile(request, resolved)
    - Targeted single step; skips batch prompt when seeding
  - result = Engine.execute(workflow, resolved)
  - persistResult = SessionManager.persist(request, resolved, result)
    - Writes derived AI turn:
      - turnType='recompute'
      - parentTurnId = sourceTurnId, sourceTurnId retained
      - sequence = -1 (off timeline) or marked as derived branch
      - providerContexts = historical contexts from the source turn
    - Persists only the recomputed response (mapping or synthesis)
    - Does not update sessions.lastTurnId
  - Emits:
    - TURN_CREATED: aiTurnId (derived), turnType='recompute', sourceTurnId
    - TURN_FINALIZED: recompute outputs + historical contexts
- UI:
  - Displays recompute result as a derived artifact; main timeline is unchanged.
Data Model (key fields)

- SessionRecord:
  - id, title, createdAt, updatedAt, lastActivity, turnCount
  - defaultThreadId, activeThreadId
  - lastTurnId (points to latest AI turn on main timeline)
- TurnRecord (user):
  - id, type='user', sessionId, threadId, createdAt, updatedAt
  - content (userMessage), sequence, turnType ('initialize' | 'extend')
  - parentTurnId (when extend)
- TurnRecord (ai):
  - id, type='ai', sessionId, threadId, userTurnId, createdAt, updatedAt
  - turnType ('initialize' | 'extend' | 'recompute')
  - parentTurnId (for extend user turn or source turn linkage)
  - sourceTurnId (recompute)
  - providerContexts: { providerId → meta } (turn‑scoped)
  - sequence: 1, 2, … (main timeline) or -1 for derived branches
  - batchResponseCount, synthesisResponseCount, mappingResponseCount
- ProviderResponseRecord:
  - id, sessionId, aiTurnId, providerId
  - responseType: 'batch' | 'synthesis' | 'mapping'
  - responseIndex: 0..n
  - text, status, meta, timestamps
Performance and Efficiency Abstractions

- Minimal Reads:
  - initialize: none
  - extend: read the latest AI turn only (providerContexts and id)
  - recompute: read the source AI turn only (and optional targeted provider_responses)
- Synchronous Compilation:
  - Compiler is pure and fast; no DB or async calls in compile.
- Append‑Only Writes:
  - Provider responses recorded per turn and provider; no mutation of previous responses.
- Turn‑Scoped Contexts:
  - Contexts live per AI turn and are merged minimally during extend.
  - Avoids global session hydration and locking.
- In‑Memory Session Cache:
  - SessionManager keeps a fast, derived snapshot for UI history loading, reading latest contexts from the latest AI turn.
- Message Protocol:
  - TURN_CREATED carries canonical userTurnId and aiTurnId (server‑generated).
  - TURN_FINALIZED carries outputs and the active turn’s contexts.
- DeclarativeNetRequest:
  - Rules registered synchronously at service worker init to ensure network constraints are enforced without blocking the execution pipeline.

Nuance: “Missing userTurnId in request” Resolution

- In this architecture, the UI never sends userTurnId in the request.
- ConnectionHandler must not require userTurnId on inbound workflow messages.
- IDs are generated during SessionManager.persist and returned via TURN_CREATED.
- Ensure any legacy validation in ConnectionHandler or request‑lifecycle is updated to accept the new primitive‑based WorkflowRequest without userTurnId.
What “done” looks like

- UI sends initialize/extend/recompute requests with type and required fields; no userTurnId provided.
- Service worker orchestrates Resolve → Compile → Execute without session‑wide hydration.
- Persistence writes turn‑scoped contexts and append‑only provider responses; lastTurnId advances for initialize/extend only.
- TURN_CREATED and TURN_FINALIZED events drive UI state updates.
- DNR rules are active at startup; offscreen singleton stable.
- Observed performance improvement on extend due to minimal reads and no blocking hydration.

Areas Needing Clarification — Proposed Resolutions for Approval

1) Context merging strategy (determinism and simplicity)

- Proposed model: providerContexts is a map keyed by providerId. For extend requests, the new turn's providerContexts is computed as:
  - newProviderContexts = { ...lastTurn.providerContexts, ...request.providerContextsPatch }
  - Overwrite semantics are at the providerId map level. If a providerId appears in providerContextsPatch, its entire value replaces the prior value.
- Optional deep-merge operator (for limited cases): If request.providerContextsPatch[providerId] contains a reserved key "$merge": true, then perform a shallow merge of first-level keys, with arrays and nested objects replaced by patch values (no recursive merge beyond one level). This avoids unpredictable deep merges while enabling incremental overrides.
- Rationale: deterministic, simple, minimizes hidden coupling. Any complex merge requirements should be explicitly compiled into a new full provider context value by the compiler rather than relying on implicit merge behavior.

2) Recompute data dependencies (inputs and persistence)

- Recompute operates on the latest persisted turn snapshot for the session and a recomputeDelta supplied in the request (e.g., prompt edits, provider selection changes, temperature, system message changes).
- The ContextResolver builds a transient resolved input from: { lastTurnSnapshot, recomputeDelta } without modifying session state.
- The WorkflowCompiler compiles transient instructions from the resolved input; the WorkflowEngine executes and streams results back to UI.
- Persistence: Recompute does not advance lastTurnId and does not persist a new turn by default. Results are transient. If the UI requests to commit a recompute result, that is modeled as a subsequent extend with the recomputeDelta embedded as providerContextsPatch or request-level overrides.
- Rationale: preserves append-only turn history for initialize/extend, keeps recompute lightweight and reversible.

3) Thread/concurrency model (session-level serialization)

- Per-session single-flight: At most one in-flight workflow per sessionId at a time. SessionManager provides a lightweight mutex (WorkflowLock) keyed by sessionId to serialize initialize/extend/recompute operations.
- Queueing: Subsequent requests for the same session are enqueued FIFO and picked up when the current operation finalizes. Cancellation tokens are supported for engine streams; a canceled operation still consumes its reserved turnId if already allocated.
- Service worker is the single orchestrator; no offscreen hydration or multi-thread state sharing. Offscreen document remains a singleton for UI rendering only when needed.
- Rationale: eliminates races across initialize/extend/recompute, simplifies correctness, aligns with service-worker event-driven constraints.

4) Sequence numbering and edge cases

- Turn ID allocation: When an initialize/extend request is accepted, SessionManager reserves a new monotonic turnSeq via an atomic increment stored alongside session metadata. The reserved ID is not reused even if the operation is later canceled or fails (holes are acceptable for auditability).
- lastTurnId advancement: lastTurnId updates only when an initialize/extend operation reaches TURN_FINALIZED. Recompute does not affect lastTurnId.
- Event flow: TURN_CREATED fires after reservation and input snapshot capture; TURN_FINALIZED fires after persistence of provider responses and contexts. UI should tolerate non-contiguous sequences.
- Rationale: predictable monotonic IDs, safe under failure/cancel, clear UI semantics.

5) Error recovery and resilience

- Compiler errors: Emit WORKFLOW_DIAGNOSTIC with structured details and terminate the operation cleanly (no turn allocation for recompute; extend retains its reserved turnId and is marked failed). The session lock is released.
- Engine/provider errors: Persist partial logs if available, mark turn status failed, emit WORKFLOW_ERROR. Allow UI to retry via a new extend using the same providerContextsPatch or corrected inputs.
- Backoff/circuit breaker: For repeated provider failures within a short window, SessionManager should apply exponential backoff to engine calls per providerId to reduce thrashing.
- Rationale: fast fail with clear diagnostics, persistent truth for extends, graceful retry paths.

6) Race conditions in extend operations (avoid incoherent merges)

- Exclusive persist transaction: persistExtend runs inside a session-scoped transaction. It snapshots lastTurn.providerContexts and applies request.providerContextsPatch under the merge strategy above to derive newProviderContexts. This snapshot+patch happens once under the lock to prevent interleaving updates.
- Streaming cancellation: If a new extend arrives while a previous extend is streaming, the previous stream is canceled via engine token and allowed to finalize as failed (consuming its turnId). The new extend then proceeds.
- UI consistency: TURN_CREATED always precedes any stream, TURN_FINALIZED (success/failed) closes the turn lifecycle; UI should render in-progress turns distinctly.
- Rationale: removes write-write races, ensures deterministic contexts per turn.

7) Performance assumptions and practical optimizations

- Indexed lookups: Ensure persistence has composite indexes on (sessionId, turnSeq) and (sessionId, providerId, turnSeq) to keep reads O(1) for last-turn access and provider response retrieval.
- Last snapshot caching: Maintain a memory cache of lastTurnSnapshot per sessionId inside the service worker (cleared on worker restart). This avoids DB hops between Resolve and Compile for the common path.
- Minimal payloads: ConnectionHandler should pass only the necessary fields to the compiler/engine to avoid oversized message payloads.
- Rationale: honors the non-hydration directive while keeping latency low.

Approval

- If these resolutions are accepted, I will incorporate them into the implementation prompt and refactor corrections as normative behavior, and proceed to wire SessionManager, ContextResolver, compiler, and engine accordingly.