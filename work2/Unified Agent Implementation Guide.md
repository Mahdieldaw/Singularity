htos Unified Agent Implementation Guide (Manifest V3, Single Document)

Purpose

- This single guide replaces fragmented prompts and corrections. Hand it directly to the agent implementing changes in this codebase.
- It consolidates architecture, guardrails, request/response contracts, persistence, orchestration, wiring, and UI updates into one authoritative source.
- Testing and feature flags are intentionally excluded. Focus is implementation.

Prime Directives

- Security is truth. If any behavior threatens security, stop, secure first, then proceed.
- Code is truth. When docs and code conflict, trust execution and adjust docs or plans accordingly.
- Preserve working truth. Integrations should not break things that already work unless required to remove security risks.

Security & MV3 Guardrails (stated once)

- DNR First: All network-layer logic must be implemented via chrome.declarativeNetRequest rules registered synchronously in the service worker init.
- No Tokens in Content Scripts: Do not emit localStorage.setItem('token', ...) or send raw cookies via postMessage to page contexts.
- Singleton Offscreen: Only one offscreen document may exist per browser session; recreate if ping fails.
- Rename, Don’t Reference: Strip HTOS/HTOS legacy naming; use the htos prefix moving forward.
- Manifest V3 Only: Do not use webRequest, background.html, or MV2-only patterns.

Build-Phase Notes

- Verify Paths: Before any file reference or creation in PowerShell snippets, use Test-Path.
- No “Move-Item” Fixes after build. Perform renames and file moves as part of planned PR steps, not ad-hoc post-build corrections.

Scope & Outcome

- Replace userTurnId-based flows with a primitive-based WorkflowRequest union: { initialize | extend | recompute }.
- Service worker orchestrates Resolve → Compile → Execute without session-wide hydration.
- Persistence is turn-scoped and append-only for initialize/extend; recompute is transient.
- TURN_CREATED and TURN_FINALIZED events drive UI updates.
- DNR rules are active at startup; offscreen singleton is stable.

Components & Responsibilities

- SessionManager (src/persistence/SessionManager.js):
  - Owns per-session lifecycle, locking, turn reservation, persistence coordination, and event emission.
  - Exposes persistInitialize, persistExtend, and persistRecompute orchestration methods.
  - Maintains in-memory cache of lastTurnSnapshot per sessionId in the service worker context.

- ContextResolver (work2/context_resolver.js → integrate to src/core or src/persistence as needed):
  - Resolves inputs for each request type using lastTurnSnapshot and inbound request payload.
  - Applies providerContexts patch semantics and builds deterministic resolved inputs.

- WorkflowCompiler (src/core/workflow-compiler.js):
  - Compiles resolved inputs into provider-specific instructions (prompts, parameters, tool calls).
  - Signals diagnostics on compile errors.

- WorkflowEngine (src/core/workflow-engine.js, work2/workflow_engine_refactor.js):
  - Executes provider instructions, streams results, supports cancellation tokens and error codes.
  - Emits WORKFLOW_ERROR for provider failures and supports backoff.

- ConnectionHandler (src/core/connection-handler.js):
  - Validates inbound union request types; removes legacy userTurnId requirements.
  - Minimizes payload content and forwards to session orchestration.
  - Bridges TURN_CREATED and TURN_FINALIZED events back to UI.

- Service Worker Entry (src/sw-entry.js):
  - Registers DNR rules synchronously.
  - Orchestrates Resolve → Compile → Execute per request without session-wide hydration.
  - Manages offscreen singleton lifecycle (create/ping/recreate as necessary).

- UI Layer (ui/*):
  - Sends initialize/extend/recompute requests without userTurnId.
  - Subscribes to TURN_CREATED and TURN_FINALIZED for state updates.
  - Updates hooks, atoms, and components to align with new request and event shapes.

Contracts & Types

- WorkflowRequest (union):
  - initialize: { type: 'initialize', sessionId, initialProviderContexts?, initialPrompt?, options? }
  - extend: { type: 'extend', sessionId, providerContextsPatch?, userMessage?, options? }
  - recompute: { type: 'recompute', sessionId, recomputeDelta, options? }

- Events:
  - TURN_CREATED: { sessionId, turnId, turnSeq, timestamp }
  - TURN_FINALIZED: { sessionId, turnId, turnSeq, status: 'success'|'failed', timestamp }
  - WORKFLOW_DIAGNOSTIC: { sessionId, turnId?, compilerDiagnostics }
  - WORKFLOW_ERROR: { sessionId, turnId?, providerId?, code, message }

- Persistence Types (high-level):
  - Session: { sessionId, lastTurnId?, lastTurnSeq?, createdAt, updatedAt }
  - Turn: { turnId, turnSeq, sessionId, providerContexts: Record<providerId, ProviderContext>, createdAt, status }
  - ProviderResponse: { turnId, providerId, segments: StreamLog[], completedAt? }

Persistence Model & Schema

- Append-only for initialize/extend. Recompute is transient and does not advance lastTurnId by default.
- Composite indexes for efficient reads:
  - (sessionId, turnSeq)
  - (sessionId, providerId, turnSeq)
- Atomic turnSeq reservation at accept-time. Holes are allowed for canceled/failed extends.
- lastTurnId advances only when initialize/extend reaches TURN_FINALIZED.

Context Merging Strategy (deterministic)

- providerContexts is a map keyed by providerId.
- For extend:
  - newProviderContexts = { ...lastTurn.providerContexts, ...request.providerContextsPatch }
  - If providerId appears in providerContextsPatch, its entire value replaces the prior value.
  - Optional shallow-merge with reserved key "$merge": true → shallow merge first-level keys; arrays/nested objects are replaced (no deep recursion).
  - Complex merges should be performed by the compiler producing a full provider context value, not by implicit runtime behavior.

Recompute Data Dependencies

- Recompute resolves transient input from { lastTurnSnapshot, recomputeDelta }.
- Compiler produces transient instructions; Engine executes and streams back.
- No persistence by default; to commit recompute outputs, the UI issues a subsequent extend with recomputeDelta as providerContextsPatch or request-level overrides.

Thread/Concurrency Model

- Per-session single-flight enforced by a session-scoped mutex in SessionManager.
- FIFO queue for concurrent requests targeting the same session.
- Cancellation tokens for engine streams; canceled extends consume reserved turnId.
- Service worker is the sole orchestrator; avoid session-wide hydration.

Sequence Numbering & Edge Cases

- Atomic turnSeq reservation on initialize/extend accept.
- lastTurnId advances on TURN_FINALIZED (initialize/extend only).
- TURN_CREATED fires after reservation/snapshot; TURN_FINALIZED after persistence of responses/contexts.
- UI tolerates non-contiguous turnSeq due to cancellations/failures.

Error Recovery & Resilience

- Compiler errors → WORKFLOW_DIAGNOSTIC. Recompute: no turn allocation. Extend: reserved turnId marked failed.
- Engine/provider errors → persist partial logs if any, mark failed, emit WORKFLOW_ERROR. Retry via new extend.
- Backoff/circuit breaker per providerId on repeated failures.

Performance & Practical Optimizations

- Composite indexes ensure O(1) access for last-turn and provider responses.
- Cache lastTurnSnapshot in the service worker; clear on worker restart.
- Minimize payloads from ConnectionHandler to compiler/engine.

Orchestration Flows (normative)

- initialize(sessionId, initialProviderContexts?, initialPrompt?)
  - Reserve turnSeq atomically; allocate turnId.
  - TURN_CREATED.
  - Resolve from initial inputs (no prior context).
  - Compile → Execute (stream, cancel supported).
  - Persist provider responses and providerContexts snapshot.
  - TURN_FINALIZED(success|failed); advance lastTurnId on success.

- extend(sessionId, providerContextsPatch?, userMessage?)
  - Reserve turnSeq atomically; allocate turnId.
  - TURN_CREATED.
  - Resolve using lastTurnSnapshot + providerContextsPatch.
  - Compile → Execute (stream, cancel supported).
  - Persist responses and new providerContexts via deterministic patch.
  - TURN_FINALIZED(success|failed); advance lastTurnId on success.

- recompute(sessionId, recomputeDelta)
  - No reservation/advance by default; TURN_CREATED optional only if a temporary turn is desired (recommend omit).
  - Resolve transient input from { lastTurnSnapshot, recomputeDelta }.
  - Compile → Execute; stream results to UI.
  - No persistence or lastTurnId change; to commit, issue extend.

Wiring Instructions (by area)

- SessionManager
  - Add a session-scoped mutex (WorkflowLock) and FIFO queue.
  - Implement: persistInitialize, persistExtend, persistRecompute (transient) with exclusive transactions.
  - Emit TURN_CREATED/TURN_FINALIZED and errors.
  - Maintain lastTurnSnapshot cache; invalidate on finalize.

- ContextResolver
  - Implement merge semantics including optional "$merge": true handling.
  - Provide resolver methods: resolveInitialize, resolveExtend, resolveRecompute.

- WorkflowCompiler
  - Accept resolved inputs with providerContexts and user prompts.
  - Produce per-provider instructions; emit WORKFLOW_DIAGNOSTIC on failure.

- WorkflowEngine
  - Execute instructions for each providerId; stream segments; support cancellation tokens.
  - Emit WORKFLOW_ERROR; apply backoff policy.

- ConnectionHandler
  - Accept WorkflowRequest union; remove userTurnId requirements and validations.
  - Forward to SessionManager orchestrations; bridge events to UI.
  - Keep payloads minimal; no tokens/cookies in messages.

- Service Worker Entry
  - Register DNR rules synchronously at startup.
  - Orchestrate Resolve → Compile → Execute; no session-wide hydration.
  - Maintain offscreen singleton: create, ping, recreate if ping fails.

- UI Layer
  - Update hooks (useChat, useRoundActions, useHistoryLoader, useInitialization, usePortMessageHandler) to work with union request types and events.
  - Remove reliance on userTurnId in request payloads.
  - Render in-progress turns distinctly; TURN_CREATED → provisional UI entry; TURN_FINALIZED → finalize.

Renaming

- Replace HTOS naming with htos across code (directories, files, symbols, imports).
  - Example: src/HTOS → src/htos; update imports accordingly.
  - Perform renames within planned PR steps; verify paths (Test-Path) before operations in any scripts.

Implementation Order (staged PRs)

- Phase 1: Type system migration
  - Introduce WorkflowRequest union in shared/contract.ts and UI types.
  - Remove userTurnId requirements in ConnectionHandler and UI payloads.

- Phase 2: Context migration
  - Implement turn-scoped providerContexts; add migration helper and updated getters.

- Phase 3: ContextResolver integration + compiler signature changes
  - Wire resolver; update compiler to consume resolved inputs.

- Phase 4: Persistence orchestration
  - Implement persistInitialize/Extend/Recompute with events and transactions.
  - Add composite indexes and lastTurnSnapshot caching.

- Phase 5: Service worker wiring and UI updates
  - Register DNR rules synchronously; ensure offscreen singleton stability.
  - Update UI hooks/atoms/components to events and request union.

Agent Checklist (succinct execution plan)

- Enforce guardrails at the top of service worker init (DNR rules, offscreen singleton).
- Implement WorkflowRequest union; remove userTurnId usage end-to-end.
- Implement SessionManager lock, queue, and persist orchestration.
- Implement ContextResolver merge strategy and resolvers for each request type.
- Update compiler/engine signatures and stream handling.
- Update ConnectionHandler to accept union types and bridge events.
- Update UI to consume TURN_CREATED/FINALIZED and send union requests.
- Add persistence indexes and lastTurnSnapshot cache.

Done Criteria

- Initialize/extend/recompute all function via the new union types with deterministic context behavior.
- TURN_CREATED and TURN_FINALIZED drive UI updates correctly.
- DNR rules registered synchronously at startup; offscreen singleton verified via ping.
- No tokens or cookies transmitted in content scripts or page messages.
- HTOS references replaced by htos.

Notes

- Use conservative, reversible changes when unsure; observe the running system and adapt.
- Prefer simple and measured decisions over clever and assumed ones.