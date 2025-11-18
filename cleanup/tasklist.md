Tier 2: UI Polish & Performance (File Reference)
4. UI Performance & State Management (#12, #13)

Goal: Optimize the UI to make it smoother, more efficient, and prevent re-renders, especially during heavy streaming.

Sub-Task A: StreamingBuffer Optimization

Action: Modify the buffer to prevent memory buildup during very long streaming responses by adding a chunk limit.

Primary Target: ui/utils/streamingBuffer.ts

Code to Add/Modify:

code
TypeScript
download
content_copy
expand_less
export class StreamingBuffer {
  // ... existing properties
  private readonly MAX_CHUNKS_PER_PROVIDER = 500; // Add this limit
  private chunkCounts: Map<string, number> = new Map(); // Add this to track counts

  addDelta(
    providerId: string,
    delta: string,
    status: string,
    responseType: ResponseType,
  ) {
    const key = `${responseType}:${providerId}`;
    if (!this.pendingDeltas.has(key)) {
      this.pendingDeltas.set(key, { /* ... */ });
      this.chunkCounts.set(key, 0); // Initialize count
    }

    // ... existing delta push logic ...

    // ADD THIS BLOCK
    const count = (this.chunkCounts.get(key) || 0) + 1;
    this.chunkCounts.set(key, count);

    if (count >= this.MAX_CHUNKS_PER_PROVIDER) {
      console.warn(`[StreamingBuffer] Max chunks for ${key} reached, forcing immediate flush.`);
      this.flushImmediate(); // Force a flush to clear memory
      return; // Exit after flushing
    }
    // END OF ADDED BLOCK

    this.scheduleBatchFlush();
  }

  private flushAll() {
    // ... existing flush logic ...
    this.chunkCounts.clear(); // Add this to reset counts after a flush
  }

  clear() {
    // ... existing clear logic ...
    this.chunkCounts.clear(); // Add this to clear counts
  }
}

Sub-Task B: Jotai atomFamily for Per-Turn State

Action: Refactor the global expandedUserTurnsAtom to use atomFamily, so that expanding one turn only re-renders that specific component, not the entire list.

Primary Target 1: ui/state/atoms.ts

Code to Add/Modify:

Import atomFamily:

code
TypeScript
download
content_copy
expand_less
import { atomFamily } from 'jotai/utils';

Replace expandedUserTurnsAtom:

Delete this line:

code
TypeScript
download
content_copy
expand_less
export const expandedUserTurnsAtom = atomWithImmer<Record<string, boolean>>({});

Add this atomFamily:

code
TypeScript
download
content_copy
expand_less
export const turnExpandedStateFamily = atomFamily(
  (turnId: string) => atom(false), // Each turn gets its own boolean atom, defaulting to false
  (a, b) => a === b // A simple equality check for the family parameter (turnId)
);

Primary Target 2: ui/components/UserTurnBlockConnected.tsx

Action: Update this component to use the new atomFamily.

Code to Modify:

code
TypeScript
download
content_copy
expand_less
import { useAtom } from "jotai";
import UserTurnBlock from "./UserTurnBlock";
import { turnExpandedStateFamily } from "../state/atoms"; // Import the new atom family

export default function UserTurnBlockConnected({ userTurn }: any) {
  // Use the atomFamily by passing the turn's ID as a parameter
  const [isExpanded, setIsExpanded] = useAtom(turnExpandedStateFamily(userTurn.id));

  const handleToggle = () => setIsExpanded((prev) => !prev);

  return (
    <UserTurnBlock
      userTurn={userTurn}
      isExpanded={isExpanded}
      onToggle={handleToggle} // Pass the simplified toggle function
    />
  );
}

Primary Target 3: ui/components/UserTurnBlock.tsx

Action: Simplify the props to accept a simple onToggle function instead of the turn ID.

Code to Modify:

code
TypeScript
download
content_copy
expand_less
interface UserTurnBlockProps {
  userTurn: UserTurn;
  isExpanded: boolean;
  onToggle: () => void; // Changed from (turnId: string) => void
}

const UserTurnBlock = ({ userTurn, isExpanded, onToggle }: UserTurnBlockProps) => {
  // ...
  return (
    // ...
    <div
      // ...
      onClick={onToggle} // The onClick now just calls the passed-in function
    >
      {/* ... */}
    </div>
    // ...
  );
};

check providerresponseblock.tsx for optimization opportunities


Memory Management (Session Registry)

Goal: Create a central registry to track active workflows and ensure their resources are cleaned up when the UI disconnects, preventing memory leaks from "zombie" objects.

Primary Target 1: New File src/core/session-registry.js

Action: Create this new file to house the SessionRegistry.

Content to Add:

code
JavaScript
download
content_copy
expand_less
class WorkflowSession {
  constructor(sessionId) {
    this.id = sessionId;
    this.resources = new Map(); // Map<resource, description>
    this.createdAt = Date.now();
  }

  addResource(resource, description) {
    if (resource && typeof resource.clear === 'function') {
      this.resources.set(resource, description);
    }
  }

  dispose() {
    console.log(`[SessionRegistry] Disposing resources for session ${this.id}`);
    this.resources.forEach((description, resource) => {
      try {
        resource.clear(); // Assumes resources have a .clear() method
      } catch (e) {
        console.warn(`Failed to clear resource '${description}':`, e);
      }
    });
    this.resources.clear();
  }
}

class SessionRegistry {
  constructor() {
    this.activeSessions = new Map();
  }

  register(sessionId) {
    if (this.activeSessions.has(sessionId)) {
      return this.activeSessions.get(sessionId);
    }
    const session = new WorkflowSession(sessionId);
    this.activeSessions.set(sessionId, session);
    return session;
  }

  unregister(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.dispose();
      this.activeSessions.delete(sessionId);
    }
  }
  
  getMemoryStats() {
     return { activeSessions: this.activeSessions.size };
  }
}

export const sessionRegistry = new SessionRegistry();
// For debugging from the service worker console
self.__HTOS_SESSION_REGISTRY = sessionRegistry;

Primary Target 2: src/core/connection-handler.js

Action: Import the sessionRegistry and use it to clean up resources when a UI port disconnects.

Code to Add/Modify:

Import at the top:

code
JavaScript
download
content_copy
expand_less
import { sessionRegistry } from './session-registry.js';

Add a property to the constructor:

code
JavaScript
download
content_copy
expand_less
this.activeSessionId = null;

Modify _handleExecuteWorkflow:

code
JavaScript
download
content_copy
expand_less
async _handleExecuteWorkflow(message) {
  // ... at the beginning of the function
  const sessionId = message.payload?.sessionId || `session-${Date.now()}`;
  this.activeSessionId = sessionId;
  sessionRegistry.register(sessionId);
  // ... rest of the function
}

Modify _cleanup:

code
JavaScript
download
content_copy
expand_less
_cleanup() {
  console.log("[ConnectionHandler] Cleaning up connection");
  if (this.activeSessionId) {
    sessionRegistry.unregister(this.activeSessionId);
    this.activeSessionId = null;
  }
  // ... rest of the cleanup logic
}

Primary Target 3: ui/hooks/usePortMessageHandler.ts

Action: Pass the StreamingBuffer instance to the service worker so it can be registered for cleanup.

Note: This is an advanced pattern. A simpler alternative is to ensure the StreamingBuffer is cleared on component unmount, which you already do. The SessionRegistry on the backend is more for backend resources. For now, let's stick to the simpler UI-side cleanup you have.

Action (Revised): In the useEffect cleanup function, ensure the buffer is cleared.

code
TypeScript
download
content_copy
expand_less
useEffect(() => {
  api.setPortMessageHandler(handler);
  return () => {
    api.setPortMessageHandler(null);
    streamingBufferRef.current?.clear(); // YOU ALREADY HAVE THIS - IT'S CORRECT!
  };
}, [handler]);




3. Circuit Breakers (#7)

Goal: Prevent the system from repeatedly calling a provider that is clearly offline or failing.

Primary Target 1: New File src/core/CircuitBreaker.js

Action: Create this new file.

Content to Add:

code
JavaScript
download
content_copy
expand_less
export class CircuitBreaker {
  constructor(options = {}) {
    this.state = 'CLOSED'; // Can be CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
    this.lastFailure = 0;
    this.failureThreshold = options.failureThreshold || 3; // Trip after 3 failures
    this.resetTimeout = options.resetTimeout || 30000; // Stay open for 30 seconds
  }

  async execute(action) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailure > this.resetTimeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error(`CircuitBreaker is OPEN for this provider. Not attempting request.`);
      }
    }

    try {
      const result = await action();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  recordSuccess() {
    this.failures = 0;
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      console.log('[CircuitBreaker] Service restored. Breaker is now CLOSED.');
    }
  }

  recordFailure() {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.state === 'HALF_OPEN' || this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      console.warn(`[CircuitBreaker] Service failing. Breaker is now OPEN for ${this.resetTimeout / 1000}s.`);
    }
  }
}

Primary Target 2: src/core/workflow-engine.js

Action: Modify the FaultTolerantOrchestrator (which is inside sw-entry.js, but logically part of the engine's domain) to use a circuit breaker for each provider.

Code to Add/Modify in sw-entry.js:

Import at the top:

code
JavaScript
download
content_copy
expand_less
import { CircuitBreaker } from './core/CircuitBreaker.js';

Modify FaultTolerantOrchestrator:

code
JavaScript
download
content_copy
expand_less
class FaultTolerantOrchestrator {
  constructor() {
    this.activeRequests = new Map();
    this.lifecycleManager = self.lifecycleManager;
    this.circuitBreakers = new Map(); // ADD THIS
  }

  // ADD THIS HELPER METHOD
  getCircuitBreaker(providerId) {
    if (!this.circuitBreakers.has(providerId)) {
      this.circuitBreakers.set(providerId, new CircuitBreaker());
    }
    return this.circuitBreakers.get(providerId);
  }

  async executeParallelFanout(prompt, providers, options = {}) {
    // ...
    const providerPromises = providers.map((providerId) => {
      return (async () => {
        // ...
        const adapter = providerRegistry.getAdapter(providerId);
        // ...

        // ADD THIS WRAPPER
        const breaker = this.getCircuitBreaker(providerId);
        try {
          return await breaker.execute(async () => {
            // ALL THE ORIGINAL LOGIC FOR A SINGLE PROVIDER GOES HERE
            // ... from `const request = { ... }`
            // ... down to `return { providerId, status: 'fulfilled', value: result };`
            // The original `catch (error)` block also goes inside this wrapper.
          });
        } catch (breakerError) {
           // This catches the "CircuitBreaker is OPEN" error
           return { providerId, status: 'rejected', reason: breakerError };
        }
        // END OF WRAPPER
      })();
    });
    // ...
  }
}



1. Error Boundaries (Fix #2)
Why it's easy: This is purely additive. You are wrapping existing components. You don't change any logic inside AiTurnBlock or ChatView.
How to do it:
Go to ui/App.tsx.
Wrap your main <ChatView /> component with the <ErrorBoundary> you already have.
<ErrorBoundary><ChatView /></ErrorBoundary>
Can you do it halfway? Yes. You can wrap one component today and another tomorrow. The rest of the app remains unaffected.
Time estimate: 15-30 minutes.



Rate Limiting (#8)

Goal: Add a simple rate limiter to prevent your extension from hammering provider APIs from a single IP address.

Primary Target 1: New File src/core/RateLimiter.js

Action: Create this new file.

Content to Add:

code
JavaScript
download
content_copy
expand_less
// A simple in-memory rate limiter using the token bucket algorithm.
export class RateLimiter {
  constructor() {
    // Map<providerId, { tokens: number, lastRefill: number }>
    this.buckets = new Map();
    this.TOKENS_PER_SECOND = 5; // Allow 5 requests per second per provider
    this.MAX_TOKENS = 10;       // Max burst capacity
  }

  async acquire(providerId) {
    let bucket = this.buckets.get(providerId);
    if (!bucket) {
      bucket = { tokens: this.MAX_TOKENS, lastRefill: Date.now() };
      this.buckets.set(providerId, bucket);
    }

    // Refill tokens based on elapsed time
    const now = Date.now();
    const elapsedMs = now - bucket.lastRefill;
    const tokensToAdd = (elapsedMs / 1000) * this.TOKENS_PER_SECOND;
    bucket.tokens = Math.min(this.MAX_TOKENS, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      // Not enough tokens, wait for the next refill interval
      const delay = (1 - bucket.tokens) * (1000 / this.TOKENS_PER_SECOND);
      await new Promise(resolve => setTimeout(resolve, delay));
      return this.acquire(providerId); // Retry after waiting
    }

    bucket.tokens -= 1;
  }
}

export const rateLimiter = new RateLimiter();

Primary Target 2: src/core/workflow-engine.js

Action: Modify the executePromptStep method. Before calling the orchestrator, loop through the providers and await the rate limiter for each one.

Code to Add:

Import at the top:

code
JavaScript
download
content_copy
expand_less
import { rateLimiter } from './RateLimiter.js';

Modify executePromptStep:

code
JavaScript
download
content_copy
expand_less
async executePromptStep(step, context) {
  const { prompt, providers, useThinking, providerContexts } = step.payload;

  // ADD THIS BLOCK
  try {
    for (const providerId of providers) {
      await rateLimiter.acquire(providerId);
    }
  } catch (e) {
    console.warn('[RateLimiter] Failed to acquire tokens', e);
    // Decide if you want to fail the step or proceed without limiting
  }
  // END OF ADDED BLOCK

  return new Promise((resolve, reject) => {
    this.orchestrator.executeParallelFanout(prompt, providers, {
      // ... rest of the function is unchanged
    });
  });
}



Tier 1: Quick Wins (File Reference)
1. Dead Code Removal (#11)

Goal: Clean up unused code to reduce complexity and potential for bugs. This is a low-risk "seek and destroy" mission.

Primary Target 1: ui/services/extension-api.ts

Action: Find and delete the entire updateProviderContext method. It's a no-op and is no longer used by the modern backend.

Snippet to Remove:

code
TypeScript
download
content_copy
expand_less
updateProviderContext(providerId: string, context: any): void {
  console.warn(
    "`updateProviderContext` is deprecated. Context is managed by the backend.",
  );
}

Primary Target 2: src/sw-entry.js

Action: Find the handleUnifiedMessage function and delete the case blocks for SAVE_TURN, CREATE_THREAD, and SWITCH_THREAD. These message types are from the old system and are no longer sent by the UI.

Snippet to Remove (inside the switch (message.type) block):

code
JavaScript
download
content_copy
expand_less
case "SAVE_TURN": {
  // ... entire case block ...
}

case "CREATE_THREAD": {
  // ... entire case block ...
}

case "SWITCH_THREAD": {
  // ... entire case block ...
}

Primary Target 3: ui/state/atoms.ts

Action: Find and delete the pendingUserTurnsAtom. This was part of a legacy optimistic UI flow that has been replaced by the TURN_CREATED message from the backend.

Snippet to Remove:

code
TypeScript
download
content_copy
expand_less
export const pendingUserTurnsAtom = atomWithImmer<Map<string, UserTurn>>(
  new Map(),
);

Follow-up: After deleting this, your code editor/TypeScript will show errors in any file that was importing it. Go to those files and remove the import. This confirms it's truly unused.