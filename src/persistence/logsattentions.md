[WorkflowEngine] Persisting initialize workflow to SessionManager
4bg.js:1303 [SessionManager] Building legacy session for session-1762262430945-ht0p1n
2bg.js:1334 [SessionManager] Processing 201 responses for session session-1762262430945-ht0p1n
bg.js:1425 [SessionManager] Successfully built legacy session for session-1762262430945-ht0p1n with 0 turns
bg.js:1426 [SessionManager] Session structure: {turns: Array(0)}
bg.js:1334 [SessionManager] Processing 202 responses for session session-1762262430945-ht0p1n
bg.js:1425 [SessionManager] Successfully built legacy session for session-1762262430945-ht0p1n with 0 turns
bg.js:1426 [SessionManager] Session structure: {turns: Array(0)}
bg.js:1334 [SessionManager] Processing 202 responses for session session-1762262430945-ht0p1n
bg.js:1303 [SessionManager] Building legacy session for session-1762262436317-n38elc
bg.js:1425 [SessionManager] Successfully built legacy session for session-1762262430945-ht0p1n with 0 turns
bg.js:1426 [SessionManager] Session structure: {turns: Array(0)}
bg.js:1425 [SessionManager] Successfully built legacy session for session-1762262430945-ht0p1n with 0 turns
bg.js:1426 [SessionManager] Session structure: {turns: Array(0)}
bg.js:1334 [SessionManager] Processing 202 responses for session session-1762262436317-n38elc
bg.js:1374 [SessionManager] Building AI turn ai-1762262430945-zvwigz: {batch: Array(4), synthesis: Array(0), mapping: Array(0)}
bg.js:1425 [SessionManager] Successfully built legacy session for session-1762262436317-n38elc with 2 turns
bg.js:1426 [SessionManager] Session structure: {turns: Array(2)}
bg.js:11966 [WorkflowEngine] Initialize complete: session=session-1762262436317-n38elc
bg.js:11885 [WorkflowEngine] Emitting TURN_FINALIZED {userTurnId: 'user-1762262430884-ppqloe', aiTurnId: 'ai-1762262430945-zvwigz', batchCount: 4, synthesisCount: 0, mappingCount: 0}
index.js:58099 [Port Handler] WORKFLOW_COMPLETE {type: 'WORKFLOW_COMPLETE', sessionId: 'session-1762262436317-n38elc', workflowId: 'wf-initialize-1762262430945-srqtdluqw', finalResults: {…}}
bg.js:11676 [makeDelta] Cleared 0 cache entries for session session-1762262436317-n38elc
index.js:58283 [Port] Ignoring WORKFLOW_COMPLETE from session-1762262436317-n38elc
(anonymous) @ index.js:58283
(anonymous) @ index.js:26920
handleMessage @ index.js:26771Understand this warning
index.js:58099 [Port Handler] TURN_FINALIZED {type: 'TURN_FINALIZED', sessionId: 'session-1762262436317-n38elc', userTurnId: 'user-1762262430884-ppqloe', aiTurnId: 'ai-1762262430945-zvwigz', turn: {…}}
index.js:58150 [Port] Ignoring TURN_FINALIZED from session-1762262436317-n38elc (active session-1762262430945-ht0p1n)
(anonymous) @ index.js:58150
(anonymous) @ index.js:26920
handleMessage @ index.js:26771Understand this warning
3bg.js:12835 [ConnectionHandler] Received: KEEPALIVE_PING