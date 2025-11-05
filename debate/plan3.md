1. Diagnosis
We need to add an interactive, sequential "Debate Mode." This workflow must be resilient to Service Worker termination, meaning all state must be persisted to the database after each step, not held in the engine's memory.

2. Proposed Solution
We will implement a Stateless-Request Loop Pattern.

The UI will drive the debate. A new debate starts with an InitializeRequest containing workflow: 'debate'.

The Workflow Compiler will generate only one Prompt step for the selected provider.

The Workflow Engine will execute this step, building a complex prompt using a new DebatePromptLibrary.

The Session Manager will persist this response and the debate's current state (e.g., stage: 1) to the AiTurnRecord.

The UI will receive the TURN_FINALIZED message, see the debate flag, and render the "Next Model" buttons.

Clicking a button will trigger a new ExtendRequest containing workflow: 'debate' and the next provider.

The Context Resolver will fetch the previous turn, read its debate state, and pass it to the Compiler.

The Compiler and Engine will then compile and execute stage: 2.

This is the Chess Tournament Analogy: The manager (Engine) makes one move, writes it down on the official scoresheet (SessionManager), and walks away. When the user is ready, a new manager can pick up the scoresheet, see the last move, and execute the next one.

3. Implementation Plan
1. shared/contract.ts (Add workflow flag)

We add the workflow flag to InitializeRequest and ExtendRequest. We do not need a new primitive.

TypeScript

export interface InitializeRequest {
  // ...
  workflow?: 'standard' | 'debate';
}

export interface ExtendRequest {
  // ...
  workflow?: 'standard' | 'debate';
}
2. src/persistence/types.ts (Add debate state to AiTurn)

The AiTurnRecord must persist the debate's state.

TypeScript

export interface AiTurnRecord extends BaseTurnRecord {
  // ...
  workflow?: 'standard' | 'debate';
  debate?: {
    stage: number; // 1, 2, 3...
    stageName: 'argument' | 'counter-argument' | 'conclusion';
    totalStages: number;
    // The original user prompt that started the debate
    originalPrompt: string; 
  };
}
3. src/core/context-resolver.js (Read persisted state)

_resolveExtend is modified to read the debate state from the last AI turn (which it already fetches).

In shared/contract.ts, update ExtendContext:

TypeScript

export interface ExtendContext {
  // ...
  lastAiTurn?: AiTurnRecord; // Give compiler full access to the last turn
}
In ContextResolver._resolveExtend(request):

JavaScript

// ...
const lastTurn = await this._getTurn(session.lastTurnId);
// ...
return {
  type: 'extend',
  sessionId,
  lastTurnId: lastTurn.id,
  providerContexts: relevantContexts,
  lastAiTurn: lastTurn, // <-- Pass the entire last turn
};
4. src/config/debate-templates.js (New File)

We create exactly the prompt matrix you described.

JavaScript

// src/config/debate-templates.js
export const DEBATE_TEMPLATES = {
  'claude': {
    'argument': ['claude-arg-1', 'claude-arg-2', 'claude-arg-3', 'claude-arg-4'],
    'counter': ['claude-count-1', 'claude-count-2', 'claude-count-3', 'claude-count-4'],
    'conclusion': ['claude-concl-1', 'claude-concl-2', 'claude-concl-3', 'claude-concl-4']
  },
  // ... etc. for gemini, chatgpt
};

export const DEBATE_META_PROMPTS = {
  'claude-arg-1': "You are a debater. Your opening argument for... ",
  // ... all 16+ templates
};

export const PROVIDER_ROTATION_MAP = {
  'claude': 0, 'gemini': 1, 'chatgpt': 2, 'qwen': 3
};
5. src/core/workflow-compiler.js (Compile one debate step)

The Compiler branches on the workflow flag and compiles only one step.

In compile(request, resolvedContext):

JavaScript

const workflowType = request.workflow || 'standard';
// ...
if (workflowType === 'debate') {
  const debateStep = this._createDebateStep(request, resolvedContext); // New method
  steps.push(debateStep);
} else {
  // ... existing standard/parallel logic ...
}
// ...
return { workflowId, context: { ...workflowContext, workflowType }, steps };
Add the new _createDebateStep method:

JavaScript

_createDebateStep(request, resolvedContext) {
  const { userMessage, providers } = request;
  const targetProvider = providers[0];
  let stage = 1;
  let stageName = 'argument';
  let previousProvider = 'user';
  let originalPrompt = userMessage;

  if (resolvedContext.type === 'extend' && resolvedContext.lastAiTurn?.debate) {
    const lastDebate = resolvedContext.lastAiTurn.debate;
    stage = lastDebate.stage + 1;
    stageName = (stage >= lastDebate.totalStages) ? 'conclusion' : (stage % 2 === 0 ? 'counter-argument' : 'argument');
    originalPrompt = lastDebate.originalPrompt;

    // Get previous provider from the last turn's *actual* response
    previousProvider = Object.keys(resolvedContext.lastAiTurn.batchResponses || {})[0] || 'user';
  }

  // Your deterministic template selection logic
  const stageKey = stageName.split('-')[0]; // 'argument', 'counter', 'conclusion'
  const templates = DEBATE_TEMPLATES[targetProvider][stageKey];
  const rotationOffset = PROVIDER_ROTATION_MAP[previousProvider] || 0;
  const templateId = templates[(stage + rotationOffset) % 4];

  return {
    stepId: `debate-s${stage}-${targetProvider}-${Date.now()}`,
    type: 'prompt', // Reuse the 'prompt' step type
    payload: {
      prompt: originalPrompt, // The *original* prompt
      providers: [targetProvider], // Only the one provider
      providerContexts: resolvedContext.providerContexts,

      debateMeta: {
        stage,
        stageName,
        totalStages: request.totalStages || 5, // UI should send this
        templateId,
        previousStepId: (resolvedContext.type === 'extend') ? resolvedContext.lastTurnId : null,
      }
    }
  };
}
6. src/core/workflow-engine.js (Inject context)

The Engine just needs to inject context for debate steps. It does not need a pause/resume mechanism.

Import DEBATE_META_PROMPTS and getDebatePrompt (or similar helper).

In execute(request, resolvedContext):

Store request.context.workflowType in the engine this.workflowType = request.context.workflowType;

In executePromptStep(step, context):

Add the branch to build the prompt:

JavaScript

async executePromptStep(step, context) {
  let { prompt, providers, useThinking, providerContexts, debateMeta } = step.payload;

  if (debateMeta) {
    // --- DEBATE PROMPT ASSEMBLY ---
    const { templateId, previousStepId } = debateMeta;

    // Get previous response text from *persisted* results
    let previousResponseText = null;
    if (previousStepId) {
      const prevTurn = await this.sessionManager.adapter.get('turns', previousStepId);
      if (prevTurn) {
        const prevResponses = await this.sessionManager.adapter.getProviderResponsesByTurnId(prevTurn.id);
        previousResponseText = prevResponses?.[0]?.text || null;
      }
    }

    const metaPrompt = DEBATE_META_PROMPTS[templateId];
    prompt = `${metaPrompt}\n\nORIGINAL TOPIC: ${prompt}\n\n${previousResponseText ? `PREVIOUS ARGUMENT:\n${previousResponseText}\n\n` : ''}YOUR TURN:`;
  }

  // --- EXECUTION (Unchanged) ---
  return new Promise((resolve, reject) => {
    this.orchestrator.executeParallelFanout(prompt, providers, {
      // ... existing options ...
      onAllComplete: (results, errors) => {
        // ...
        // Add debateMeta to the final result for persistence
        const finalResults = { results: Object.fromEntries(results) };
        if (debateMeta) finalResults.debateMeta = debateMeta; 
        resolve(finalResults);
      }
    });
  });
}
7. src/persistence/SessionManager.js (Persist state)

The persist method now saves the debate state on the AiTurnRecord.

In _persistInitialize and _persistExtend:

When creating aiTurnRecord, check for the debateMeta on the result object (which the Engine added).

const debateMeta = result.debateMeta; // from executePromptStep

JavaScript

const aiTurnRecord = {
  // ...
  workflow: this.workflowType || 'standard',
  debate: debateMeta ? {
    stage: debateMeta.stage,
    stageName: debateMeta.stageName,
    totalStages: debateMeta.totalStages,
    originalPrompt: result.originalPrompt,
  } : undefined,
  // ...
};
4. Validation / Why This Works
This combined approach is the most elegant and robust:

It's Resilient: By persisting state to the AiTurnRecord after every step, the system is fully resilient to Service Worker termination.

It's Stateless: The backend (Compiler, Engine) remains stateless per request. It doesn't need complex, stateful loops with in-memory stepResults or _modelSelectionResolvers.

It Reuses Your Architecture: It correctly uses the Context Resolver to read state, the Compiler to define the next single step, the Engine to execute it, and the Session Manager to persist the new state. This is your Resolve -> Compile -> Execute pattern applied perfectly to a sequential loop.

It's Extensible: Your "extend-to-debate" (Phase 2) is now trivial. The UI just sends an InitializeRequest { workflow: 'debate', ... } and includes a sourceTurnId. The Context Resolver will see this, fetch that turn's batchResponses, and pass them to the Compiler to be used as the "history" for the first debate step.

You were right that the "Compiler Pattern" is key, but that pattern is more powerful when combined with a stateless, resilient engine. This architecture gives you the "16-prompt matrix" logic you want, inside the "SW-proof" execution model I proposed.