# Exploratory Instructions: Add Session ID Pre-Generation

## Goal

Ensure session IDs are generated upfront in the backend (similar to turn IDs) to eliminate null/empty string handling issues throughout the system.

-----

## Investigation Phase

Before making changes, verify the current state of the code:

### 1. Check Current Session ID Flow

*Examine:* src/core/connection-handler.js in _handleExecuteWorkflow

*Questions to answer:*

- Where does executeRequest.sessionId come from?
- What value does it have for new conversations? (null, empty string, or something else?)
- Is there already any session ID generation logic here?
- After workflowRequest = this.services.compiler.compile(executeRequest), what does workflowRequest.context.sessionId contain?

*Examine:* src/core/workflow-compiler.js

*Questions to answer:*

- Where does the compiler currently generate new session IDs?
- What conditions trigger new session ID creation? (Look for checks like sessionId === null or !sessionId)
- If we provide a valid session ID from connection-handler, will the compiler still work correctly?
- Are there any side effects if we skip the compiler’s session ID generation?

### 2. Check Frontend Session Handling

*Examine:* ui/hooks/useChat.ts in the sendMessage function

*Questions to answer:*

- What does the code currently send for sessionId in new conversations?
- Is it null, "" (empty string), or currentSessionId || ''?
- Where is currentSessionId set initially?

*Examine:* ui/hooks/usePortMessageHandler.ts

*Questions to answer:*

- Is there already logic that updates currentSessionId when messages arrive?
- Where is setCurrentSessionId called currently?
- Does the TURN_CREATED handler need to update the session ID?

-----

## Implementation Phase

Based on your investigation, implement the following changes if they make sense for your codebase:

### Change 1: Backend Session ID Generation

*File:* src/core/connection-handler.js

*Location:* In _handleExecuteWorkflow, after you’ve generated aiTurnId and before sending TURN_CREATED

*Proposed logic:*

javascript
// Check if session ID is missing or invalid
let sessionId = executeRequest.sessionId;
if (!sessionId || sessionId === '') {
  // Generate new session ID upfront
  sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  console.log('[Backend] Generated new session ID:', sessionId);
}


*Important questions before implementing:*

- Should we override workflowRequest.context.sessionId with this value?
- Will the compiler’s existing session logic still work if we pre-populate this?
- Does the TURN_CREATED message need the real session ID, or can it use whatever the compiler decides?

*Potential implementation:*

javascript
// Ensure workflow context uses the real session ID
if (workflowRequest.context) {
  workflowRequest.context.sessionId = sessionId;
}

// Include in TURN_CREATED message
this.port.postMessage({
  type: 'TURN_CREATED',
  sessionId: sessionId,  // Should this be the pre-generated ID or workflowRequest.context.sessionId?
  userTurnId: userTurnId,
  aiTurnId: aiTurnId,
});


### Change 2: Frontend Session ID Update

*File:* ui/hooks/usePortMessageHandler.ts

*Location:* In the TURN_CREATED case handler

*Investigation first:*

- Check if currentSessionId is available in this scope
- Check if setCurrentSessionId exists and what it does
- Determine if the session ID should only be set for new conversations or always updated

*Proposed addition:*

typescript
case 'TURN_CREATED': {
  const { userTurnId, aiTurnId, sessionId } = message;
  
  // Should we check if currentSessionId is null/empty before updating?
  // Or should we always trust the backend's session ID?
  if (!currentSessionId || currentSessionId === '') {
    setCurrentSessionId(sessionId);
  }
  // ... rest of existing handler
}


### Change 3: Frontend Request Normalization

*File:* ui/hooks/useChat.ts

*Location:* Where ExecuteWorkflowRequest is built

*Investigation first:*

- What does requestMode === 'new-conversation' actually mean?
- What is currentSessionId at this point for new conversations?
- Should we send null or just omit the field entirely?

*Proposed change:*

typescript
const request: ExecuteWorkflowRequest = {
  // For new conversations, send null explicitly
  // For continuations, send the existing session ID
  sessionId: (requestMode === 'new-conversation' ? null : currentSessionId),
  userTurnId: userTurnId,
  // ... rest of request
};


*But verify:*

- Does the TypeScript contract allow null?
- Will the backend handle null correctly?
- Is there existing logic that expects empty string instead?

-----

## Verification Phase

After implementing changes, verify:

### 1. Backend Verification

- Add logging to see what session ID values flow through connection-handler
- Check if the compiler still creates/hydrates sessions correctly
- Verify TURN_CREATED message contains a valid session ID

### 2. Frontend Verification

- Start a new conversation - check if session ID appears in the UI state
- Send a second message in the same conversation - verify it uses the same session ID
- Check browser console for any errors related to session handling

### 3. Integration Testing

- Test new conversation flow end-to-end
- Test continuation of existing conversation
- Verify no “new-session” static IDs appear
- Verify no session merging occurs between separate conversations

-----

## Rollback Plan

If issues arise:

1. The changes are isolated to 3 files and ~15 lines
1. The compiler’s original session logic should still work as fallback
1. Remove the session ID generation from connection-handler first
1. Revert frontend changes if session state becomes inconsistent

-----

## Questions to Answer During Implementation

1. Does the compiler’s _ensureSessionHydration still work with pre-generated IDs?
1. Should we remove the compiler’s session ID generation code, or leave it as fallback?
1. Does the SESSION_STARTED message need to be sent/handled?
1. Are there any other places that expect sessionId to be null for new conversations?

Implement carefully and test each change independently if possible.