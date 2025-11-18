Progress Summary

- Completed tasks #3, #7, #8, #11, #12, and #13 end-to-end.
- Built successfully with no bundling errors; background script and UI bundle generated.
Memory Management (#3)

- Adds a per-provider chunk cap and dynamic flush throttling to the streaming buffer.
  - Per-provider limits: ui/utils/streamingBuffer.ts:26 and ui/utils/streamingBuffer.ts:56-63
  - Throttled flush (double-RAF with min interval): ui/utils/streamingBuffer.ts:66-83
  - Immediate flush when max chunks reached: ui/utils/streamingBuffer.ts:58-61
  - Clears counters and updates last flush time: ui/utils/streamingBuffer.ts:104-111
  - Safe flush cancellation and buffer reset: ui/utils/streamingBuffer.ts:114-124 and ui/utils/streamingBuffer.ts:126-137
  - Memory stats helper for observability: ui/utils/streamingBuffer.ts:139-154
- Introduces a session registry to track and dispose resources (timers, RAF, abort controllers) per workflow session.
  - Registry and session classes: src/core/session-registry.js:1-124
  - Register and unregister on execution lifecycle: src/core/connection-handler.js:2 , src/core/connection-handler.js:21 , src/core/connection-handler.js:39-45 , src/core/connection-handler.js:51-56
- Wires abort controllers into the registry during provider fanout.
  - Attachment to registry: src/sw-entry.js:35-37 , src/sw-entry.js:240-246
Circuit Breakers (#7)

- Adds a lightweight circuit breaker with CLOSED/OPEN/HALF_OPEN state machine and thresholds.
  - Implementation: src/core/CircuitBreaker.js:1-37
- Wraps adapter calls per provider via the breaker inside the orchestrator fanout.
  - Integration: src/sw-entry.js:314-335 with setup at src/sw-entry.js:35-37
Rate Limiting (#8)

- Adds a token-bucket style rate limiter with configurable refill rate and burst.
  - Implementation: src/core/RateLimiter.js:1-26
- Enforces acquisition for each provider before starting parallel fanout.
  - Enforcement: src/core/workflow-engine.js:1040-1048
Dead Code Removal (#11)

- Removes deprecated UI method and legacy service worker cases:
  - Drops UI updateProviderContext : ui/services/extension-api.ts:289-295
  - Removes legacy message types in SW: src/sw-entry.js legacy cases for SAVE_TURN , CREATE_THREAD , and SWITCH_THREAD deleted (surrounding message handler remains intact).
- Verified no remaining imports of pendingUserTurnsAtom ; references exist only in planning docs.
State Simplification (#12)

- Switches turn expansion state from a global record to per-turn atoms using atomFamily .
  - Atom family: ui/state/atoms.ts:93-96
  - Connected component updated: ui/components/UserTurnBlockConnected.tsx:6-16
  - Pure display component signature aligned: ui/components/UserTurnBlock.tsx:55-59 and toggle handler usage at ui/components/UserTurnBlock.tsx:119-121
UI Performance (#13)

- Tunes virtualization buffer to reduce off-screen rendering while keeping scroll stability.
  - Buffer tuning: ui/views/ChatView.tsx:increaseViewportBy changed to { top: 300, bottom: 200 }
- Reduces re-renders from global state writes via per-turn atomFamily change and streaming flush throttling.
Verification

- Build runs clean and completes:
  - Background: dist/bg.js
  - UI bundle: dist/ui/index.js
- Command output confirms success:
  - npm run build → background 388.4kb, UI ~1.9mb, postbuild completed.
Design Notes

- Memory safety: Per-provider MAX_CHUNKS set to 500 with immediate flush when reached; avoids unbounded growth in long streams.
- Orchestration safety: Circuit breaker protects against failing providers causing systemic retries; rate limiter reduces burst load across providers.
- Resource lifecycle: Session registry tracks abort controllers and disposes them when sessions end; integrates directly in fanout so aborts propagate reliably.
- UI state locality: Using atomFamily isolates subscriptions to each turn making expand/collapse interactions cheaper and avoiding global re-render on single turn state changes.
What Changed Where

- ui/utils/streamingBuffer.ts:26-35, 56-63, 66-83, 104-111, 114-124, 126-137, 139-154
- src/core/session-registry.js:1-124
- src/core/connection-handler.js:2, 21, 39-45, 51-56
- src/core/CircuitBreaker.js:1-37
- src/core/RateLimiter.js:1-26
- src/core/workflow-engine.js:1040-1048
- src/sw-entry.js:35-37, 240-246, 314-335
- ui/state/atoms.ts:93-96
- ui/components/UserTurnBlockConnected.tsx:6-16
- ui/components/UserTurnBlock.tsx:55-59, 119-121
- ui/views/ChatView.tsx:increaseViewportBy adjustment
- ui/services/extension-api.ts:289-295
Assumptions

- Provider IDs are stable strings that uniquely key rate limiters and circuit breakers.
- Removing legacy SW message cases is safe because new workflow APIs and events handle persistence and threads; no UI references remain to the removed cases.
- The token bucket defaults ( TOKENS_PER_SECOND=5 , MAX_TOKENS=10 ) are conservative; tune as needed based on real traffic.
Next Steps

- Add basic counters in the UI debug overlay using StreamingBuffer.getMemoryStats() for observability.
- Optionally persist circuit breaker state per provider across SW restarts if you want longer-lived protection.
- Tune the rate limiter values with live metrics once you profile provider latencies and quotas.