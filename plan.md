

1. *Contract Update* - Ensure TurnCreatedMessage in shared/contract.ts includes sessionId: string (not optional)
1. *Error Handling* - In connection-handler, add validation:

javascript
if (!sessionId || sessionId === '') {
  sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  console.log('[Backend] Generated new session ID:', sessionId);
}


1. *Cleanup Check* - Verify no other code references SESSION_STARTED message (search codebase)

Otherwise, the plan is *complete and ready to execute*. Here are the formal instructions:

-----

# Implementation Instructions: Session ID Pre-Generation

## Overview

Move session ID generation from the WorkflowEngine to the connection-handler, enabling the frontend to receive the authoritative session ID immediately via the TURN_CREATED message. This eliminates the SESSION_STARTED message and simplifies the message flow.

-----

## Phase 1: Backend Changes

### Step 1: Pre-Generate Session ID in Connection Handler

*File:* src/core/connection-handler.js

*Location:* In the _handleExecuteWorkflow method, immediately after extracting executeRequest but *before* calling the compiler

*Action:* Add session ID generation logic

*Implementation:*

javascript
async _handleExecuteWorkflow(message) {
  const executeRequest = message.payload;
  
  // ... existing lifecycle manager and session relocation logic ...

  try {
    await this._ensureSessionHydration(executeRequest);
    
    // === NEW: Pre-generate session ID if missing ===
    if (!executeRequest.sessionId || executeRequest.sessionId === '') {
      executeRequest.sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      console.log('[Backend] Generated new session ID:', executeRequest.sessionId);
    }
    // === END NEW ===
    
    // Compile with the complete request (now includes valid sessionId)
    const workflowRequest = this.services.compiler.compile(executeRequest);
    
    // Extract user turn ID and generate AI turn ID
    const userTurnId = executeRequest.userTurnId;
    if (!userTurnId) {
      console.error('[Backend] Missing userTurnId in request');
      return;
    }
    
    const aiTurnId = `ai-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    
    // Attach canonical IDs to workflow context
    workflowRequest.context.canonicalUserTurnId = userTurnId;
    workflowRequest.context.canonicalAiTurnId = aiTurnId;
    
    // === MODIFIED: Include sessionId in TURN_CREATED ===
    this.port.postMessage({
      type: 'TURN_CREATED',
      sessionId: workflowRequest.context.sessionId, // Now guaranteed to be valid
      userTurnId: userTurnId,
      aiTurnId: aiTurnId,
    });
    // === END MODIFIED ===
    
    // Execute workflow
    await this.workflowEngine.execute(workflowRequest);
    
  } finally {
    // ... existing cleanup logic ...
  }
}


*Verification:*

- Add temporary logging to confirm session ID generation occurs only for new conversations
- Verify the TURN_CREATED message includes a valid sessionId

-----

### Step 2: Remove SESSION_STARTED Message

*File:* src/core/workflow-engine.js

*Location:* Find where SESSION_STARTED message is sent (likely in _run or _initialize method)

*Action:* Delete the code that sends the SESSION_STARTED message

*Search for:*

javascript
this.port.postMessage({
  type: 'SESSION_STARTED',
  sessionId: // ...
});


*Delete:* The entire message send block

*Verification:*

- Search the entire codebase for 'SESSION_STARTED' to ensure no other code references it
- If found elsewhere, evaluate if it needs updating or removal

-----

## Phase 2: Frontend Changes

### Step 3: Update TURN_CREATED Handler

*File:* ui/hooks/usePortMessageHandler.ts

*Location:* In the message switch statement, inside the TURN_CREATED case

*Action:* Add logic to update the current session ID

*Current code:*

typescript
case 'TURN_CREATED': {
  const { userTurnId, aiTurnId, sessionId } = message;
  
  const userTurn = turnsMap.get(userTurnId) as UserTurn | undefined;
  if (!userTurn) {
    console.error('[Port] Could not find user turn:', userTurnId);
    return;
  }
  
  // ... rest of handler
}


*Add after extracting message data:*

typescript
case 'TURN_CREATED': {
  const { userTurnId, aiTurnId, sessionId } = message;
  
  // === NEW: Update session ID if this is a new conversation ===
  if (!currentSessionId) {
    setCurrentSessionId(sessionId);
    console.log('[Port] Set new session ID:', sessionId);
  }
  // === END NEW ===
  
  const userTurn = turnsMap.get(userTurnId) as UserTurn | undefined;
  if (!userTurn) {
    console.error('[Port] Could not find user turn:', userTurnId);
    return;
  }
  
  // ... rest of handler remains unchanged
}


*Verification:*

- Ensure currentSessionId and setCurrentSessionId are in scope
- Check they’re imported/accessed correctly from atoms

-----

### Step 4: Remove SESSION_STARTED Handler

*File:* ui/hooks/usePortMessageHandler.ts

*Location:* In the message switch statement

*Action:* Delete the entire SESSION_STARTED case block

*Search for:*

typescript
case 'SESSION_STARTED': {
  const { sessionId } = message;
  if (sessionId) {
    setCurrentSessionId(sessionId);
  }
  break;
}


*Delete:* The entire case block (including the break statement)

*Verification:*

- Search the frontend codebase for 'SESSION_STARTED' to ensure no other references exist
- Check that no other code depends on this message type

-----

### Step 5: Verify Frontend Request Format

*File:* ui/hooks/useChat.ts

*Location:* In the sendMessage function where ExecuteWorkflowRequest is built

*Action:* Verify the code sends null for new conversations (no changes needed if correct)

*Current expected code:*

typescript
const request: ExecuteWorkflowRequest = {
  sessionId: (requestMode === 'new-conversation' ? null : currentSessionId),
  userTurnId: userTurnId,
  // ... rest of request
};


*Verify:*

- No || '' fallback patterns exist
- currentSessionId atom is initialized to null
- No code paths that might inject empty strings

*If found incorrect:* Change to the pattern above

-----

## Phase 3: Contract Verification

### Step 6: Verify TypeScript Contracts

*File:* shared/contract.ts

**Verify TurnCreatedMessage includes sessionId:**

typescript
export interface TurnCreatedMessage {
  type: 'TURN_CREATED';
  userTurnId: string;
  aiTurnId: string;
  sessionId: string; // Must be present and non-optional
}


**Verify ExecuteWorkflowRequest allows null:**

typescript
export interface ExecuteWorkflowRequest {
  sessionId: string | null; // Allow null for new conversations
  userTurnId: string;
  // ...
}


*If incorrect:* Update to match the above patterns

-----

## Phase 4: Build and Test

### Step 7: Build the Project

*Commands:*

bash
npm run clean
npm run build


*Verify:*

- Build completes without TypeScript errors
- dist/ui directory exists and contains compiled files

-----

### Step 8: Integration Testing

*Test Scenario 1: New Conversation*

1. Start the application
1. Send a new message (new conversation)
1. *Verify:*

- Backend console shows “Generated new session ID: session-…”
- Frontend receives TURN_CREATED with a valid sessionId
- Frontend console shows “Set new session ID: session-…”
- currentSessionId atom is populated
- No duplicate turns appear
- No errors in console

*Test Scenario 2: Continuation*

1. Continue the conversation from Test 1
1. Send a second message
1. *Verify:*

- Backend does NOT generate a new session ID
- Backend uses the existing session ID from the request
- Frontend maintains the same currentSessionId
- Message is added to the same conversation
- No errors in console

*Test Scenario 3: Multiple New Conversations*

1. Start a new conversation (Conversation A)
1. Start another new conversation (Conversation B)
1. *Verify:*

- Each gets a unique session ID
- No session merging occurs
- Histories remain separate
- No “new-session” static ID appears

*Test Scenario 4: Page Refresh*

1. Start a new conversation
1. Send multiple messages
1. Refresh the page
1. Continue the conversation
1. *Verify:*

- Session is restored correctly
- History loads properly
- New messages use the correct session ID
- No duplicate sessions created

-----

## Phase 5: Cleanup

### Step 9: Remove Temporary Logging

*Action:* Remove any console.log statements added for debugging

*Locations:*

- src/core/connection-handler.js - Session ID generation log
- ui/hooks/usePortMessageHandler.ts - Session ID set log

-----

## Rollback Plan

If issues arise during testing:

1. *Revert backend changes* in connection-handler.js

- Remove session ID pre-generation logic
- Restore original TURN_CREATED message format

1. **Restore SESSION_STARTED in workflow-engine.js**

- Re-add the message send logic

1. *Revert frontend changes* in usePortMessageHandler.ts

- Remove session ID logic from TURN_CREATED handler
- Restore SESSION_STARTED case handler

1. *Run build and test* to verify system returns to working state

-----

## Success Criteria

The implementation is successful when:

✅ New conversations receive unique session IDs immediately
✅ No SESSION_STARTED messages are sent or handled
✅ Session IDs are available in the TURN_CREATED message
✅ Frontend sets currentSessionId correctly for new conversations
✅ Continuation messages use existing session IDs
✅ No duplicate turns appear
✅ No session merging between separate conversations
✅ No “new-session” static IDs appear in the system
✅ All tests pass without console errors