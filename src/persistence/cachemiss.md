    }
    // 2. Fallback to persistence-backed retrieval/creation
    console.log(`[SessionManager] Cache miss for session: ${sessionId}. Fetching from DB...`);
    return this.getOrCreateSessionWithPersistence(sessionId);
  }

  /**
   * Get or create session using new persistence layer
   */
  async getOrCreateSessionWithPersistence(sessionId) {
    try {
      // Prefer cached session if present
      if (this.sessions && this.sessions[sessionId]) {
        console.log(`[SessionManager] (WithPersistence) Cache hit for session: ${sessionId}`);
        return this.sessions[sessionId];
      }
      // Try to get existing session
      let sessionRecord = await this.adapter.get('sessions', sessionId); 


      what is the current state of the refactor:

Phase 1: Laying the New Foundation (Data Schema & Contracts)

Goal: Update the core data structures and API contracts. This is the bedrock for all subsequent changes. No logic will be

changed in this phase, only definitions.

1. Update Persistence Types (`src/persistence/types.ts`):

* Modify the SessionRecord interface:

* Remove the providerContexts property.

* Add an optional lastTurnId: string property.

* Modify the TurnRecord interface (or its equivalent, e.g., AiTurnRecord):

* Add providerContexts: Record<string, any>.

* Add turnType: 'initialize' | 'extend' | 'recompute'.

* Add an optional parentTurnId: string.

* Add an optional sourceTurnId: string.

2. Update API Contract (`shared/contract.ts`):

* Remove the ExecuteWorkflowRequest interface.

* Add the new request interfaces: InitializeRequest, ExtendRequest, and RecomputeRequest.

* Add the WorkflowRequest union type (type WorkflowRequest = InitializeRequest | ExtendRequest | RecomputeRequest;).

* Add the new context interfaces: InitializeContext, ExtendContext, RecomputeContext, and the ResolvedContext union

type.

---

Phase 2: Implement the Context Resolver & Update Entry Point

Goal: Introduce the new ContextResolver and wire it into the ConnectionHandler, fundamentally changing the request

lifecycle. The old hydration path will be removed.

1. Create the Context Resolver (`src/core/context-resolver.js`):

* Create this new file.

* Implement the ContextResolver class as detailed in plan core.md. It should have a resolve(request) method that

switches on request.type and returns the appropriate ResolvedContext. This class will depend on the SessionManager.

2. Refactor the Connection Handler (`src/core/connection-handler.js`):

* Inject the new ContextResolver into the ConnectionHandler's constructor.

* Completely refactor the _handleExecuteWorkflow method to follow the new three-phase flow:

1. const resolvedContext = await this.contextResolver.resolve(request);

2. const workflow = await this.compiler.compile(request, resolvedContext);

3. const result = await this.engine.execute(workflow, resolvedContext);

* DELETE the _ensureSessionHydration method and all calls to it. This is the primary performance bottleneck we are

eliminating.

3. Update Service Worker (`src/sw-entry.js`):

* In the composition root (likely initializeGlobalServices), instantiate the new ContextResolver.

* Inject the ContextResolver instance into the ConnectionHandler when it is created.

---

Phase 3: Decouple the Workflow Compiler and Engine

Goal: Make the WorkflowCompiler a pure, synchronous function and update the WorkflowEngine to handle the new

ResolvedContext.

1. Refactor the Workflow Compiler (`src/core/workflow-compiler.js`):

* Change the compile method signature to compile(request: WorkflowRequest, context: ResolvedContext).

* Remove all `async`/`await` and any internal data-fetching logic (e.g., database or session manager calls).

* Replace the complex if/else branching based on mode with a simple switch on context.type. All data needed for

compilation must now come from the request and context arguments.

2. Refactor the Workflow Engine (`src/core/workflow-engine.js`):

* Change the execute method signature to execute(workflow: WorkflowRequest, context: ResolvedContext).

* Add logic at the beginning of execute to handle the recompute case by seeding the stepResults map with the

frozenBatchOutputs from the RecomputeContext.

* Update the internal step execution methods (_executeMappingStep, _executeSynthesisStep) to source their required data

from the context object instead of other sources.

Phase 4: Implement Turn-Based Persistence

Goal: Overhaul the SessionManager to persist data on a per-turn basis, storing provider contexts with each turn.

1. Refactor the Session Manager (`src/persistence/SessionManager.js`):

* Remove the old persistence logic (e.g., persistWorkflowResult).

* Implement the new persist(request, context, result) method as detailed in plan core.md.

* This method will contain the switch statement to call the private helper methods for each primitive:

_persistInitialize, _persistExtend, and _persistRecompute.

* Implement these three private methods, ensuring they create and save Turn objects with the correct, turn-scoped

providerContexts.

2. Update Repositories (`src/persistence/repositories/*.ts`):

* Modify the SessionsRepository and TurnsRepository to handle the updated SessionRecord and TurnRecord schemas from

Phase 1.

* If it exists, the ProviderContextsRepository is now deprecated and its usage should be removed from the

SessionManager.

Phase 5: Update Client-Side Request Creation

Goal: Update the UI to construct and send the new, explicit WorkflowRequest primitives.

1. Update Chat Hook (`ui/hooks/useChat.ts`):

* Refactor the sendMessage function. It should no longer use a mode parameter.

* Instead, it should check for the presence of a currentSessionId.

* If a session ID exists, construct and send an ExtendRequest.

* If no session ID exists, construct and send an InitializeRequest.

2. Update Actions Hook (`ui/hooks/useRoundActions.ts`):

* Refactor the functions responsible for historical reruns (e.g., runSynthesisForRound).

* Instead of creating a complex ExecuteWorkflowRequest with historicalContext, they must now construct and send a clean

RecomputeRequest.

Phase 6: Final Polish and Database Migration

Goal: Unify the provider adapter interface and write the one-time data mig script



 Yes, that is a perfect summary. You have captured the essence of the refactor for
  the SessionManager exactly.

  Let me just re-confirm and expand slightly on your points, because you've nailed
  all the key concepts:

   1. Initialize and Extend Flows: You are spot on. The old, complex logic of
      "building a session" is being thrown away. It's being replaced by two simple,
      clear flows:
       * Initialize is the special "first turn" action. Its job is to create the
         SessionRecord in the database and save the first UserTurnRecord and
         AiTurnRecord.
       * Extend is the action for every subsequent turn. Its job is simply to save a
         new UserTurnRecord and AiTurnRecord and link them to the session that
         Initialize created.

   2. Recompute and Reading Persisted Data: Correct again. Recompute is the new,
      formal backend primitive for what the UI used to trigger as "historical
      synthesis/mapping." And you've identified the most critical part of the new
      architecture:
       * When a RecomputeRequest comes in, the ContextResolver will now "read the
         data directly from the persisted" TurnRecord specified by the sourceTurnId.
         This is possible because we are now saving each turn as its own unique
         object. The ContextResolver can fetch just that one record to get the
         frozenBatchOutputs it needs, without having to load or process an entire
         session.

  Your understanding is complete. The SessionManager's job becomes much simpler: it
  just needs to write these unique turn records to the database based on which of the
   three primitives (Initialize, Extend, Recompute) is being executed by the
  WorkflowEngine.


  Fully refactor the persistence layer (SessionManager) to align with the new
  turn-based, immutable architecture. This will involve systematically removing all 9
   instances of the deprecated buildLegacySessionObject function, fixing the
  associated session desynchronization bugs, and repurposing the in-memory cache to
  support the new data model.

  High-Level Strategy

  The refactor will be executed in three sequential stages to ensure safety and
  correctness:
   1. Stage 1: Refactor the Readers. First, we will modify all parts of the
      application that read or expect the old, monolithic session object format.
   2. Stage 2: Remove the Writers. Once nothing is reading the old format, we will
      remove the code that writes the old format to the in-memory cache.
   3. Stage 3: Delete the Legacy Code. With all calls removed, we will delete the dead
       legacy code itself.

  Finally, we will refactor the cache to align with its new purpose.

  ---

  Detailed Implementation Plan

  Stage 1: Refactor Consumers of the Legacy Session Object

  The goal of this stage is to update all code that depends on the old session
  format.

   1. Refactor the History Loader (`sw-entry.js`)
       * File: src/sw-entry.js
       * Location: The GET_HISTORY_SESSION message handler (around line 499).
       * Action: Replace the call to sm.buildLegacySessionObject(sessionId). The new
         logic must query the persistence adapter directly for all TurnRecords and
         ProviderResponseRecords where the sessionId matches. Return this collection
         of individual, new-style records. The responsibility of assembling these
         records into a viewable format now belongs to the UI.

   2. Remove Fallback Logic from `workflow-engine.js`
       * File: src/core/workflow-engine.js
       * Location: The fallback try...catch block for historical mapping lookup
         (around line 1227).
       * Action: Delete the entire try...catch block that calls
         this.sessionManager.buildLegacySessionObject. The engine must trust the
         ResolvedContext it is given. If context is missing, it is a ContextResolver
         issue, not one for the engine to solve with legacy fallbacks.

   3. Deprecate `getOrCreateSessionWithPersistence`
       * File: src/persistence/SessionManager.js
       * Location: The getOrCreateSessionWithPersistence method (which calls
         buildLegacySessionObject around line 715).
       * Action: Once the changes in sw-entry.js and workflow-engine.js are complete,
          this method should have no more callers. It can be marked as deprecated and
          subsequently deleted.

  Stage 2: Remove Legacy Cache Warming

  The goal of this stage is to stop populating the in-memory cache (this.sessions)
  with the outdated legacy object.

   1. Clean up `_persistInitialize`, `_persistExtend`, and `_persistRecompute`
       * File: src/persistence/SessionManager.js
       * Locations:
           * Inside _persistInitialize (around line 127)
           * Inside _persistExtend (around line 204)
           * Inside _persistRecompute (around line 266)
       * Action: In each of these three methods, delete the block of code that calls
         buildLegacySessionObject and updates the cache. The block to delete looks
         like this:
   1         // DELETE THIS BLOCK
   2         const legacySession = await this.buildLegacySessionObject(sessionId);
   3         if (legacySession) this.sessions[sessionId] = legacySession;

  Stage 3: Delete the Legacy Code

  The goal of this stage is to eradicate the dead code completely.

   1. Delete the Function Implementation
       * File: src/persistence/SessionManager.js
       * Location: The buildLegacySessionObject function definition (around line
         732).
       * Action: Delete the entire async buildLegacySessionObject(sessionId) { ... }
         function.

   2. Delete the Type Definition
       * File: src/persistence/SessionManager.d.ts
       * Location: The buildLegacySessionObject line in the type definition (around
         line 57).
       * Action: Delete the line.

  Final Step: Refactor the Cache's Purpose

  The goal of this step is to align the in-memory cache with the new, lightweight
  data model.

   1. Repurpose the `this.sessions` Cache:
       * This cache should no longer hold large, complex session objects. Its new
         purpose is to cache only the lightweight `SessionRecord` metadata (e.g., { 
         id, title, createdAt, updatedAt, lastTurnId }).

   2. Update Cache Writers:
       * Modify the _persistInitialize method. After creating the new SessionRecord
         and saving it to the adapter, add it to the in-memory cache:
         this.sessions[sessionRecord.id] = sessionRecord;.
       * Modify any other method that updates session metadata (e.g., changing a
         title) to also update the record in the this.sessions cache.

   3. Update Cache Readers:
       * Review any remaining code that reads from this.sessions. Ensure it is only
         expecting the lightweight SessionRecord metadata, not the old object with a
         turns array. Any code that needs the actual turn data must now query the
         database for the individual TurnRecords.