// src/core/workflow-compiler.js (FINAL, COMPLETE VERSION)
/**
 * WorkflowCompiler
 *
 * Translates a high-level ExecuteWorkflowRequest into a sequence of
 * low-level WorkflowSteps the engine can execute.
 *
 * Principles:
 * - Declarative input (ExecuteWorkflowRequest)
 * - Imperative output (WorkflowRequest.steps)
 * - Stateless given session state read-only
 */

export class WorkflowCompiler {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
  }

  compile(request) {
    this._validateRequest(request);

    const {
      mode,
      sessionId,
      threadId,
      userMessage,
      providers,
      providerModes = {}, // Default to empty object for safety
      providerMeta = {},
      synthesis,
      mapping,
      useThinking,
      historicalContext,
    } = request;

    // Defensive: if sessionId is null but this is clearly not a new conversation
    // (historical mapping/synthesis or continuation), attempt to relocate to the
    // correct session before generating context. This complements the
    // ConnectionHandler-level relocation.
    let effectiveSessionId = sessionId;
    try {
      const isHistorical = !!historicalContext?.userTurnId;
      const isContinuation = mode === 'continuation';
      const isNew = mode === 'new-conversation';
      if (!isNew && !effectiveSessionId) {
        if (isHistorical) {
          const targetTurnId = historicalContext.userTurnId;
          const sessions = this.sessionManager?.sessions || {};
          for (const [sid, s] of Object.entries(sessions)) {
            const turns = Array.isArray(s?.turns) ? s.turns : [];
            const idx = turns.findIndex(t => t?.id === targetTurnId && (t?.type === 'user' || t?.role === 'user'));
            if (idx !== -1) { effectiveSessionId = sid; break; }
          }
        }
        if (!effectiveSessionId && isContinuation) {
          const sessions = this.sessionManager?.sessions || {};
          let bestSid = null, bestTs = -1;
          for (const [sid, s] of Object.entries(sessions)) {
            const ts = Number(s?.lastActivity) || 0;
            if (ts > bestTs) { bestTs = ts; bestSid = sid; }
          }
          if (bestSid) effectiveSessionId = bestSid;
        }
      }
    } catch (_) {}

    const workflowId = this._generateWorkflowId(mode);
    const steps = [];

    const shouldRunBatch = providers && providers.length > 0;
    const batchStepId = shouldRunBatch ? `batch-${Date.now()}` : null;

    // STEP 1: Batch prompt (optional)
    if (shouldRunBatch) {
      const isSynthesisFirst =
        synthesis?.enabled &&
        synthesis.providers.length > 0 &&
        providers.length > 1;

      steps.push({
        stepId: batchStepId,
        type: "prompt",
        payload: {
          prompt: userMessage,
          providers: providers,
          hidden: !!isSynthesisFirst,
          useThinking: !!useThinking,
          // ✅ ADDED providerModes to this function call
          providerContexts: this._getProviderContexts(
            sessionId,
            threadId,
            mode,
            providers,
            providerModes,
            historicalContext
          ),
          // ✅ Pass through per-provider metadata (e.g., gemini model)
          providerMeta,
        },
      });
      try {
        console.log('[Compiler] Batch step created', {
          batchStepId,
          hidden: !!isSynthesisFirst,
          providers,
          mode,
          providerModes
        });
      } catch (_) {}
    }

    // Calculate latestUserTurnId once for both synthesis and mapping steps
    // If there is no batch step in this workflow and no explicit historical turn
    // provided by the UI, automatically source from the latest completed turn
    // so synthesis/mapping works on subsequent rounds without needing explicit UI context.
    const latestUserTurnId = (!historicalContext?.userTurnId && !batchStepId)
      ? this._getLatestUserTurnId(effectiveSessionId || sessionId)
      : null;

    // STEP 2: Mapping (one step per selected mapping provider) - NOW RUNS FIRST
    const mappingStepIds = [];
    if (mapping?.enabled && mapping.providers.length > 0) {
      mapping.providers.forEach((provider) => {
        const mappingStepId = `mapping-${provider}-${Date.now()}`;
        mappingStepIds.push(mappingStepId);
        // ✅ RESPECTS providerModes override
        const providerMode = providerModes[provider] || mode;

        const mappingStep = {
          stepId: mappingStepId,
          type: "mapping",
          payload: {
            mappingProvider: provider,
            continueFromBatchStep: (providerModes[provider] !== 'new-conversation' && batchStepId)
              ? batchStepId
              : undefined,
            sourceStepIds: historicalContext?.userTurnId
              ? undefined
              : batchStepId
              ? [batchStepId]
              : undefined,
            sourceHistorical: historicalContext?.userTurnId
              ? {
                  turnId: historicalContext.userTurnId,
                  responseType: historicalContext.sourceType || "batch",
                }
              : latestUserTurnId
              ? {
                  turnId: latestUserTurnId,
                  responseType: "batch",
                }
              : undefined,
            originalPrompt: userMessage,
            useThinking: !!useThinking && provider === "chatgpt",
            attemptNumber: historicalContext?.attemptNumber || 1,
          },
        };
        steps.push(mappingStep);
        try {
          console.log('[Compiler] Mapping step', {
            mappingStepId,
            provider,
            ...mappingStep.payload
          });
        } catch (_) {}
      });
    }

    // STEP 3: Synthesis (one step per selected synthesis provider) - NOW RUNS AFTER MAPPING
    if (synthesis?.enabled && synthesis.providers.length > 0) {
      synthesis.providers.forEach((provider) => {
        const synthStepId = `synthesis-${provider}-${Date.now()}`;
        // ✅ RESPECTS providerModes override for determining continuation
        const providerMode = providerModes[provider] || mode;

        const synthStep = {
          stepId: synthStepId,
          type: "synthesis",
          payload: {
            synthesisProvider: provider,
            continueFromBatchStep: (providerModes[provider] !== 'new-conversation' && batchStepId)
              ? batchStepId
              : undefined,
            sourceStepIds: historicalContext?.userTurnId
              ? undefined
              : batchStepId
              ? [batchStepId]
              : undefined,
            // NEW: Include mapping step IDs as dependencies for synthesis
            mappingStepIds: mappingStepIds.length > 0 ? mappingStepIds : undefined,
            sourceHistorical: historicalContext?.userTurnId
              ? {
                  turnId: historicalContext.userTurnId,
                  responseType: historicalContext.sourceType || "batch",
                }
              : latestUserTurnId
              ? {
                  turnId: latestUserTurnId,
                  responseType: "batch",
                }
              : undefined,
            originalPrompt: userMessage,
            useThinking: !!useThinking && provider === "chatgpt",
            attemptNumber: historicalContext?.attemptNumber || 1,
          },
        };
        steps.push(synthStep);
        try {
          console.log('[Compiler] Synthesis step', {
            synthStepId,
            provider,
            ...synthStep.payload
          });
        } catch (_) {}
      });
    }

    return {
      workflowId,
      // If the caller explicitly passed `null` for sessionId it means the
      // frontend wants the backend to create the session id. Create a new
      // deterministic id here and flag the context so the engine will emit
      // a SESSION_STARTED message immediately.
      context: (() => {
        let ctxSessionId;
        let sessionCreated = false;
        if (mode === 'new-conversation' && sessionId === null) {
          // Only create new session for explicit new-conversation
          ctxSessionId = `sid-${Date.now()}`;
          sessionCreated = true;
        } else {
          ctxSessionId = effectiveSessionId || sessionId || "new-session";
        }
        return {
          sessionId: ctxSessionId,
          threadId: threadId || "default-thread",
          targetUserTurnId: historicalContext?.userTurnId || "",
          sessionCreated,
          userMessage
        };
      })(),
      steps,
    };
  }

  // Helper Methods

  // ✅ ADDED providerModes parameter to function signature
  _getProviderContexts(
    sessionId,
    threadId,
    mode,
    providers,
    providerModes,
    historicalContext
  ) {
    if (historicalContext?.branchPointTurnId) {
      return this._getInheritedContexts(
        sessionId,
        historicalContext.branchPointTurnId,
        providers
      );
    }
    if (mode === "new-conversation" && !historicalContext?.userTurnId) {
      return undefined;
    }
    const contexts = this.sessionManager.getProviderContexts(
      sessionId,
      threadId
    );
    if (!contexts) return undefined;

    const result = {};
    providers.forEach((providerId) => {
      // ✅ LOGIC ADDED to respect per-provider override
      const providerMode = providerModes[providerId] || mode;
      if (providerMode === "new-conversation") {
        return; // Skip context for this provider to force a new conversation
      }

      if (contexts[providerId]) {
        result[providerId] = {
          meta: contexts[providerId].meta,
          continueThread: true,
        };
      }
    });
    return Object.keys(result).length > 0 ? result : undefined;
  }

  // ... (the rest of the helper methods are identical and correct) ...

  _getInheritedContexts(sessionId, branchPointTurnId, providers) {
    const session = this.sessionManager.sessions?.[sessionId];
    if (!session) return undefined;
    const branchIndex = session.turns.findIndex(
      (t) => t.id === branchPointTurnId
    );
    if (branchIndex === -1) return undefined;
    const result = {};
    providers.forEach((providerId) => {
      for (let i = branchIndex; i >= 0; i--) {
        const turn = session.turns[i];
        if (turn.type === "ai" && turn.batchResponses?.[providerId]) {
          result[providerId] = {
            meta: turn.batchResponses[providerId].meta,
            continueThread: true,
          };
          break;
        }
      }
    });
    return Object.keys(result).length > 0 ? result : undefined;
  }

  _generateWorkflowId(mode) {
    return `wf-${mode}-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;
  }

  _validateRequest(request) {
    if (!request) throw new Error("Request is required");
    const validModes = ["new-conversation", "continuation"];
    if (!request.mode || !validModes.includes(request.mode)) {
      throw new Error(
        `mode is required and must be one of: ${validModes.join(", ")}`
      );
    }
    if (!request.historicalContext?.userTurnId) {
      if (!request.userMessage || !request.userMessage.trim()) {
        throw new Error("userMessage is required for non-historical requests");
      }
    }
    const hasProviders = request.providers && request.providers.length > 0;
    const hasSynthesis =
      request.synthesis?.enabled && request.synthesis.providers?.length > 0;
    const hasMapping =
      request.mapping?.enabled && request.mapping.providers?.length > 0;
    if (!hasProviders && !hasSynthesis && !hasMapping) {
      throw new Error(
        "Request must specify at least one action: providers, synthesis, or mapping."
      );
    }
    const validProviders = ["claude", "gemini", "gemini-pro", "chatgpt", "qwen"];
    const allProviderIds = [
      ...(request.providers || []),
      ...(request.synthesis?.providers || []),
      ...(request.mapping?.providers || []),
      ...Object.keys(request.providerModes || {}),
    ];
    const invalid = allProviderIds.filter(
      (p) => p && !validProviders.includes(p)
    );
    if (invalid.length > 0)
      throw new Error(`Invalid providers: ${invalid.join(", ")}`);
  }

  // Returns the most recent user turn id in the session for default historical sourcing
  _getLatestUserTurnId(sessionId) {
    try {
      const session = this.sessionManager.sessions?.[sessionId];
      if (!session || !Array.isArray(session.turns)) return null;
      for (let i = session.turns.length - 1; i >= 0; i--) {
        const t = session.turns[i];
        if (t && t.type === 'user' && t.id) return t.id;
      }
      return null;
    } catch (_) {
      return null;
    }
  }
}
