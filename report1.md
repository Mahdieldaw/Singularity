
  Definitive Report: Session ID Pre-Generation Implementation Plan

  This report provides a comprehensive analysis of the session ID lifecycle and a final, actionable plan for refactoring the backend to
   pre-generate session IDs, ensuring data consistency and eliminating bugs related to null or empty string handling.

  Part 1: Refined Investigation Findings

  The follow-up investigation confirms the initial analysis and answers the critical questions required to finalize the implementation
  plan.

  1. `SESSION_STARTED` Message Lifecycle

   * Location: The SESSION_STARTED message is sent from `src/core/workflow-engine.js`.
   * Timing: It is sent after the SessionManager has been called to create or hydrate the session, but before any prompt steps in the
     workflow are executed. This happens relatively early but is not immediate.
   * Contents: The message contains only the `sessionId`. It has no other metadata.
   * Conclusion: Because SESSION_STARTED only contains the sessionId and is sent later than the proposed TURN_CREATED message, it is
     redundant. It can and should be replaced to simplify the message flow.

  2. `SessionManager` Creation Logic

   * Location: Session creation logic is in `src/core/session-manager.js`.
   * Mechanism: The SessionManager uses a getOrCreateSession(sessionId) pattern.
   * Behavior:
       * If a valid, non-empty sessionId string is passed, it retrieves the session with that ID or creates a new one using that exact 
         ID.
       * If null or undefined is passed, it generates a new random ID and creates a new session.
   * Conclusion: The SessionManager can safely handle pre-generated IDs. It will correctly create a new session record using the ID
     provided by the connection-handler, which is the exact behavior we need.

  3. Context Override Safety

   * Analysis: The workflowRequest.context object returned by the WorkflowCompiler is a plain JavaScript object and is not read-only. It
     is safe to modify its properties after the compile() method has run.
   * Architectural Choice: While overriding the context after compilation is possible, it is architecturally cleaner to modify the input
     before compilation. The compiler is designed to be a function that transforms a request into a workflow; therefore, the request it
     receives should be as complete as possible. Modifying the input (executeRequest) ensures the compiler has the final, authoritative
     sessionId from the very beginning and uses it to build its context, leaving no room for ambiguity.
   * Conclusion: The safest and cleanest approach is to modify `executeRequest.sessionId` before calling `compile()`.

  4. Empty String (`""`) Handling Verification

   * Analysis: A thorough review of ui/hooks/useChat.ts confirms that for new conversations, the sessionId is explicitly set to null. The
      currentSessionId atom is initialized to null, and the logic (requestMode === 'new-conversation' ? null : currentSessionId)
     correctly passes this null value.
   * Conclusion: The primary code path is safe. There are no obvious error recovery or session restoration paths that would inject an
     empty string. While the risk is low, hardening the backend against this possibility is still best practice. The proposed
     implementation achieves this.

  ---

  Part 2: The Definitive Implementation Plan

  Based on the investigation, the following is the final, confirmed plan.

  Decision 1: Replace `SESSION_STARTED`
   * We will adopt Option B. The SESSION_STARTED message will be removed entirely. The frontend will rely exclusively on the new
     sessionId property in the TURN_CREATED message to initialize its session state.

  Decision 2: Pre-Generate in `connection-handler`
   * The SessionManager is confirmed to handle pre-generated IDs correctly. We will proceed with generating the sessionId in
     connection-handler.js for all new sessions.

  Decision 3: Modify Request *Before* Compilation
   * We will modify the executeRequest object before passing it to the compiler. This is the architecturally cleaner pattern.

  Step-by-Step Implementation:

  Step 1: Modify Backend `connection-handler.js`

   * File: src/core/connection-handler.js
   * Location: Inside the _handleExecuteWorkflow method.
   * Action: Before calling the compiler, check if the sessionId is falsy (null, undefined, or "") and generate a new one if needed.
     Then, modify the TURN_CREATED message to include this authoritative sessionId.

  Step 2: Modify Backend `workflow-engine.js`

   * File: src/core/workflow-engine.js
   * Location: Inside the _run or _initialize method where SESSION_STARTED is sent.
   * Action: Delete the lines that send the SESSION_STARTED message. It is now redundant.

  Step 3: Modify Frontend `usePortMessageHandler.ts`

   * File: ui/hooks/usePortMessageHandler.ts
   * Action 1: In the message handler, add logic to the TURN_CREATED case to set the session ID.
   * Action 2: Delete the entire `case 'SESSION_STARTED':` block, as this message will no longer be sent.

  Step 4: (Verification) Normalize Frontend `useChat.ts`

   * File: ui/hooks/useChat.ts
   * Action: No code change is strictly necessary as it already sends null. However, as a matter of good practice, ensure the code is
     clear and that no fallback logic like || '' exists that could create an empty string.

  ---

  Part 3: Execution and Verification Strategy

   1. Implement Backend Changes: Apply the modifications to connection-handler.js and workflow-engine.js.
   2. Implement Frontend Changes: Apply the modifications to usePortMessageHandler.ts.
   3. Backend Verification:
       * Add a temporary console.log in connection-handler.js to confirm that a new ID is generated only when starting a new
         conversation.
       * Add a temporary console.log to confirm the TURN_CREATED message being sent includes the new sessionId.
   4. Frontend Verification:
       * Start a new conversation. Use React DevTools or log statements to verify that the currentSessionIdAtom is set correctly
         immediately after the first AI response begins to stream.
       * Send a second message in the same conversation and verify, via backend logs, that the executeWorkflow request now contains the
         correct sessionId and that a new ID is not generated.
   5. Integration Test:
       * Perform the end-to-end new conversation flow.
       * Refresh the page and continue the conversation to ensure session restoration still works.
       * Quickly start two separate new conversations and ensure they are assigned different session IDs and that their histories do not
         merge.
       * Confirm that the static "new-session" ID no longer appears anywhere.