Objective

  To make the application's UI fully resilient to backend errors or timeouts that may
   occur during a workflow. The UI must never get permanently stuck in a loading
  state. It should always recover, provide clear feedback to the user, and allow them
   to continue interacting with the application.

  Problem Description

  Currently, if a mapping or synthesis step fails on the backend (due to an
  internal error or a timeout), the UI does not receive a clear failure signal.
  This causes the UI to remain in a "generating" state indefinitely, blocking the
  user from sending new messages or retrying the failed action. This issue is most
  noticeable in the recompute flow but can affect initialize and extend workflows
  as well.

  Desired Behavior

   1. Error Recovery: When any workflow step (batch, mapping, or synthesis) fails or
      times out, the UI must gracefully handle the error.
   2. Stop Loading Indicators: The specific UI element that was showing a "generating"
       state (e.g., a specific mapping box or a global loading bar) must stop.
   3. Provide Feedback: The UI should ideally indicate that an error occurred, for
      instance, by showing an error message in the relevant response box.
   4. Unlock Interaction: The user must be able to continue using the application,
      either by sending a new message in the chat input or by retrying the failed
      action (e.g., recomputing again).
   5. Consistency: This resilient behavior must be applied consistently across all
      three workflow primitives: Initialize, Extend, and Recompute.

  ---

  Implementation Plan

  This plan involves changes to both the backend (to guarantee failure signals) and
   the frontend (to correctly handle those signals).

  Part 1: Backend (`WorkflowEngine`) — Guarantee Failure Signals

  The backend must be modified to ensure it always sends a clear success or failure
   signal for every step.

   1. Implement Step Timeouts:
       * In the WorkflowEngine, wrap the core logic of executeMappingStep and
         executeSynthesisStep with a timeout mechanism (e.g., using Promise.race with
          a setTimeout of 30 seconds).
       * If a step's execution time exceeds this timeout, it must be treated as a
         failure.

   2. Implement `try...catch` for Step Execution:
       * Ensure the execution of executeMappingStep and executeSynthesisStep is
         wrapped in a try...catch block.
       * In the event of a timeout or any other caught error, the catch block must
         emit a WORKFLOW_STEP_UPDATE message to the frontend with the following
         payload:

   1         {
   2           "type": "WORKFLOW_STEP_UPDATE",
   3           "stepId": "the-id-of-the-failed-step",
   4           "status": "failed",
   5           "error": { "message": "Mapping timed out" },
   6           // For recompute flows, these are critical:
   7           "isRecompute": true, // or false
   8           "sourceTurnId": "the-id-of-the-source-turn" // if applicable
   9         }

  Part 2: Frontend (`usePortMessageHandler.ts`) — Handle Failure Signals

  The frontend message handler must be updated to process these new failure signals
  and unlock the UI.

   1. Update the `WORKFLOW_STEP_UPDATE` Handler:
       * Locate the case 'WORKFLOW_STEP_UPDATE': block.
       * Add an else if (status === 'failed') condition to specifically handle
         failure messages.

   2. Implement Failure Logic: Inside the new else if (status === 'failed') block, add
       the following logic:
       * For Recompute Failures: Check if message.isRecompute is true. If so, call
         setActiveRecomputeState(null). This is the critical action that will stop the
         targeted loading spinner for a failed recompute.
       * For Standard Workflow Failures (`Initialize`/`Extend`): If isRecompute is
         false, call setIsLoading(false) and setUiPhase('awaiting_action'). This will
         clear any global loading indicators.
       * (UX Improvement) Store the Error: For all failures, find the target AiTurn
         object in the turnsMap (using message.sourceTurnId for recomputes or the
         activeAiTurnId for standard flows). Update the specific provider response
         that failed by setting its status to 'failed' and attaching the error object
         from the message. This will allow the UI to display the error.

  Part 3: Frontend (UI Components) — Display Errors

  The UI components should be updated to visually represent the error state.

   1. Modify `ProviderResponseBlock.tsx` (or equivalent):
       * The component that renders a single provider response (for mapping,
         synthesis, or batch) should be updated.
       * Add logic to check the status of the response object it is rendering.
       * If status === 'failed', it should render a distinct error UI (e.g., a red
         border, an error icon, and the response.error.message text) instead of the
         content or a loading spinner.