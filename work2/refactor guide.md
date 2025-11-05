You are absolutely right to question this. My apologies for the conflicting and heavy-handed instructions. A blind "replace the file" approach is risky and goes against the core principle of a surgical refactor.

The plan is sound, but the instructions to execute it need to be more precise.

Let's clarify the philosophy. The provided refactored files should be treated as a definitive guide to the target architecture and a source for the new logic patterns, not as literal drop-in replacements. The existing codebase contains valuable, battle-tested business logic (e.g., how meta objects are constructed, specific DNR gate calls, subtle error handling) that must be preserved.

Here is a revised, safer, and more accurate prompt that makes this distinction clear.

Revised and Clarified Refactor Prompt
Mission

Execute a comprehensive architectural refactoring of the Chrome extension's backend and API contract. The goal is to transition from a mutable, session-based context model to an immutable, turn-based context model, driven by three explicit workflow primitives: Initialize, Extend, and Recompute.

Guiding Philosophy: Refactor, Don't Just Replace

For Structural Files (Contracts & Types): These files define the new architecture. Their contents should replace the old versions entirely, as the old structures are now obsolete.

For Logic Files (Handlers, Engine, Compiler, Manager): These files contain existing business logic. You must surgically refactor them. Use the provided "refactor" files as a definitive guide for the new architectural pattern and control flow, but carefully migrate the existing implementation details into this new structure. Do not discard existing logic unless it is explicitly made redundant by the new architecture (e.g., _ensureSessionHydration).

Phase 1: Establish the New Schema and API Contract

Objective: Lay the foundation by updating the core data and communication structures.

File: src/persistence/types.ts

Action: Replace. This file defines the new data schema. Replace its contents with the provided turn-based schema definitions. The old schema is incompatible with the new persistence model.

File: shared/contract.ts

Action: Replace. This file is the API contract. Replace its contents with the new contract defining the Initialize, Extend, and Recompute primitives. The old ExecuteWorkflowRequest is obsolete.

Phase 2: Implement the Backend Refactor

Objective: Re-architect the backend to use the new three-phase workflow (Resolve -> Compile -> Execute).

File: src/persistence/database.ts

Action: Surgically Update. Increment DB_VERSION to 2. In the onupgradeneeded handler, carefully implement the one-time migration script as provided. This script is critical for backfilling turn-based contexts into existing data.

File: src/core/context-resolver.js (NEW FILE)

Action: Create. Implement this new file exactly as specified. It is a new, self-contained abstraction.

File: src/core/connection-handler.js

Action: Surgically Refactor.

Modify the constructor to accept the new contextResolver service.

Completely refactor the _handleExecuteWorkflow method to implement the new three-phase flow: call contextResolver.resolve(), then compiler.compile(), then engine.execute(). Use the provided connection_handler_refactor.js as the template for this new flow.

Delete the _ensureSessionHydration method and all related logic. It is replaced by the ContextResolver.

Preserve the existing logic within _createMessageHandler for handling other message types like KEEPALIVE_PING and abort.

File: src/core/workflow-compiler.js

Action: Surgically Refactor.

Change the compile method to be a pure, synchronous function with the new signature: compile(request, context).

Remove all async logic and any direct database or SessionManager access from within the compile method.

Replace the old if/else control flow with the new switch statement based on context.type.

Preserve and adapt the logic within the helper methods (_createBatchStep, _createMappingStep, etc.) to correctly construct the step payloads. Use the workflow_compiler_refactor.js as the guide for the new structure.

File: src/core/workflow-engine.js

Action: Surgically Refactor.

Update the execute method signature to execute(workflow, context).

Implement the new logic at the start of execute for the recompute primitive, which seeds stepResults with frozenBatchOutputs.

Preserve the core implementation details within the step execution methods (executePromptStep, executeMappingStep, etc.), but update them to source their context from the ResolvedContext argument, as shown in the refactored example.

File: src/sw-entry.js

Action: Surgically Update.

In initializeGlobalServices, import and instantiate the ContextResolver. Add it to the object returned by the function.

Update the ConnectionHandler instantiation to inject the new contextResolver service.

Phase 3: Overhaul Persistence Logic

Objective: Update SessionManager to be the orchestration layer for the new turn-based persistence model.

File: src/persistence/SessionManager.js

Action: Major Surgical Refactor. This is not a file replacement.

Add the new high-level persist(request, context, result) method and its private helpers (_persistInitialize, _persistExtend, _persistRecompute) using the provided implementation snippets.

Find where the WorkflowEngine was previously calling persistence logic (e.g., _persistCriticalTurnData) and replace that call with a single call to this.sessionManager.persist(...).

Carefully update, do not replace, the buildLegacySessionObject method. Its logic must be changed to correctly read the new schema where providerContexts are located on each AiTurnRecord, not on the SessionRecord. This method remains critical for loading historical chats into the UI.

Phase 4: Refactor the UI Layer

Objective: Update the UI to construct and send the new primitive-based requests and adapt to the new state management reality.

File: ui/state/atoms.ts

Action: Surgically Update. Delete the providerContextsAtom. This atom is now obsolete. No other changes are needed here.

File: ui/hooks/useChat.ts and ui/hooks/useRoundActions.ts

Action: Surgically Refactor.

In useChat.ts, modify the sendMessage function to construct and send an InitializeRequest (for new chats) or an ExtendRequest (for continuations).

In useRoundActions.ts, modify the runSynthesisForRound and runMappingForRound functions to construct and send a RecomputeRequest.

File: ui/hooks/usePortMessageHandler.ts

Action: Surgically Refactor. Remove all logic that writes to the (now-deleted) providerContextsAtom. The TURN_FINALIZED message now contains all necessary data to fully update the turnsMapAtom.

Constraint

The final refactored code must preserve all existing functionality. The end-user experience should be functionally identical but with a noticeable performance improvement for continuation actions due to the removal of blocking hydration.

Final Output

Provide the complete, final, and refactored source code for all modified and newly created files. Ensure they are fully functional, type-correct, and seamlessly integrated into the existing project structure.