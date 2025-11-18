// ============================================================================
// ENHANCED ERROR HANDLING FOR WORKFLOW ENGINE
// Prevents silent failures and provides graceful degradation
// ============================================================================

// === ADD onError CALLBACK TO ORCHESTRATOR ===
async executePromptStep(step, context) {
  const { prompt, providers, useThinking, providerContexts } = step.payload;

  return new Promise((resolve, reject) => {
    const results = new Map();
    const errors = new Map();
    let completedCount = 0;
    const totalProviders = providers.length;
    
    this.orchestrator.executeParallelFanout(prompt, providers, {
      sessionId: context.sessionId,
      useThinking,
      providerContexts,
      providerMeta: step?.payload?.providerMeta,
      
      onPartial: (providerId, chunk) => {
        this._dispatchPartialDelta(
          context.sessionId,
          step.stepId,
          providerId,
          chunk.text,
          "Prompt",
        );
      },
      
      onProviderComplete: (providerId, data) => {
        completedCount++;
        try {
          this.port.postMessage({
            type: "WORKFLOW_STEP_UPDATE",
            sessionId: context.sessionId,
            stepId: step.stepId,
            status: "completed",
            result: {
              providerId,
              text: data?.text || "",
              status: "completed",
              meta: data?.meta || {},
            },
          });
        } catch (e) {
          console.warn('[WorkflowEngine] Failed to send provider complete message:', e);
        }
      },
      
      // ✅ NEW: Add error callback for graceful degradation
      onError: (error) => {
        console.error('[WorkflowEngine] Orchestrator error:', error);
        
        // Send error notification to UI
        try {
          this.port.postMessage({
            type: "WORKFLOW_STEP_UPDATE",
            sessionId: context.sessionId,
            stepId: step.stepId,
            status: "partial_failure",
            error: error.message,
            partialResults: Object.fromEntries(results),
          });
        } catch (e) {
          console.error('[WorkflowEngine] Failed to send error message:', e);
        }
        
        // Don't reject if we have partial results
        if (results.size > 0) {
          console.warn('[WorkflowEngine] Graceful degradation: using partial results');
          resolve({
            results: Object.fromEntries(results),
            errors: Object.fromEntries(errors),
            partial: true,
          });
        } else {
          reject(error);
        }
      },
      
      onAllComplete: (resultsMap, errorsMap) => {
        // Merge results
        resultsMap.forEach((result, providerId) => {
          results.set(providerId, result);
        });
        errorsMap.forEach((error, providerId) => {
          errors.set(providerId, error);
        });
        
        // Batch update provider contexts
        const batchUpdates = {};
        results.forEach((res, pid) => {
          batchUpdates[pid] = res;
        });
        
        // ✅ Synchronous in-memory update
        this.sessionManager.updateProviderContextsBatch(
          context.sessionId,
          batchUpdates,
          true,
          { skipSave: true }
        );
        
        // Async persistence (fire-and-forget)
        this._persistProviderContextsAsync(context.sessionId, batchUpdates);
        
        // Format results
        const formattedResults = {};
        results.forEach((result, providerId) => {
          formattedResults[providerId] = {
            providerId,
            text: result.text || "",
            status: "completed",
            meta: result.meta || {},
            ...(result.softError ? { softError: result.softError } : {}),
          };
        });
        
        errors.forEach((error, providerId) => {
          formattedResults[providerId] = {
            providerId,
            text: "",
            status: "failed",
            meta: { _rawError: error.message },
          };
        });
        
        // ✅ Validate at least one provider succeeded
        const hasAnyValidResults = Object.values(formattedResults).some(
          (r) => r.status === "completed" && r.text && r.text.trim().length > 0
        );
        
        if (!hasAnyValidResults) {
          reject(new Error("All providers failed or returned empty responses"));
          return;
        }
        
        resolve({
          results: formattedResults,
          errors: Object.fromEntries(errors),
        });
      },
    });
  });
}

// ============================================================================
// STANDARDIZED ERROR TYPES
// ============================================================================

class WorkflowError extends Error {
  constructor(message, code = 'UNKNOWN_ERROR', recoverable = false, context = {}) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
    this.recoverable = recoverable;
    this.context = context;
    this.timestamp = Date.now();
  }
  
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      recoverable: this.recoverable,
      context: this.context,
      timestamp: this.timestamp,
    };
  }
}

// ============================================================================
// ERROR HANDLING WRAPPER FOR ALL WORKFLOW STEPS
// ============================================================================

async execute(request, resolvedContext) {
  const { context, steps } = request;
  const stepResults = new Map();
  const workflowContexts = {};
  
  // Cache current user message
  this.currentUserMessage = context?.userMessage || this.currentUserMessage || "";
  
  // Ensure session exists
  if (!context.sessionId || context.sessionId === "new-session") {
    context.sessionId = context.sessionId && context.sessionId !== "new-session"
      ? context.sessionId
      : `sid-${Date.now()}`;
  }
  
  try {
    // Seed contexts from ResolvedContext
    if (resolvedContext && resolvedContext.type === "recompute") {
      console.log("[WorkflowEngine] Seeding frozen batch outputs for recompute");
      try {
        stepResults.set("batch", {
          status: "completed",
          result: { results: resolvedContext.frozenBatchOutputs },
        });
      } catch (e) {
        console.warn("[WorkflowEngine] Failed to seed frozen batch outputs:", e);
      }
      
      try {
        Object.entries(resolvedContext.providerContextsAtSourceTurn || {}).forEach(
          ([pid, ctx]) => {
            if (ctx && typeof ctx === "object") {
              workflowContexts[pid] = ctx;
            }
          }
        );
      } catch (e) {
        console.warn("[WorkflowEngine] Failed to cache historical provider contexts:", e);
      }
    }
    
    if (resolvedContext && resolvedContext.type === "extend") {
      try {
        const ctxs = resolvedContext.providerContexts || {};
        const cachedProviders = [];
        Object.entries(ctxs).forEach(([pid, meta]) => {
          if (meta && typeof meta === "object" && Object.keys(meta).length > 0) {
            workflowContexts[pid] = meta;
            cachedProviders.push(pid);
          }
        });
        if (cachedProviders.length > 0) {
          console.log(
            `[WorkflowEngine] Pre-cached contexts from ResolvedContext.extend for providers: ${cachedProviders.join(", ")}`
          );
        }
      } catch (e) {
        console.warn("[WorkflowEngine] Failed to cache provider contexts from extend:", e);
      }
    }
    
    const promptSteps = steps.filter((step) => step.type === "prompt");
    const synthesisSteps = steps.filter((step) => step.type === "synthesis");
    const mappingSteps = steps.filter((step) => step.type === "mapping");
    
    // ✅ CRITICAL: Wrap each step execution in try-catch
    // Execute prompt steps
    for (const step of promptSteps) {
      try {
        const result = await this.executePromptStep(step, context);
        stepResults.set(step.stepId, { status: "completed", result });
        
        this.port.postMessage({
          type: "WORKFLOW_STEP_UPDATE",
          sessionId: context.sessionId,
          stepId: step.stepId,
          status: "completed",
          result,
          isRecompute: resolvedContext?.type === "recompute",
          sourceTurnId: resolvedContext?.sourceTurnId,
        });
        
        // Cache provider contexts
        try {
          const resultsObj = result && result.results ? result.results : {};
          const cachedProviders = [];
          Object.entries(resultsObj).forEach(([pid, data]) => {
            if (data && data.meta && Object.keys(data.meta).length > 0) {
              workflowContexts[pid] = data.meta;
              cachedProviders.push(pid);
            }
          });
          if (cachedProviders.length > 0) {
            console.log(
              `[WorkflowEngine] Cached contexts for providers: ${cachedProviders.join(", ")}`
            );
          }
        } catch (e) {
          console.warn('[WorkflowEngine] Failed to cache contexts:', e);
        }
      } catch (error) {
        console.error(`[WorkflowEngine] ❌ Prompt step ${step.stepId} failed:`, error);
        
        stepResults.set(step.stepId, {
          status: "failed",
          error: error.message,
        });
        
        this.port.postMessage({
          type: "WORKFLOW_STEP_UPDATE",
          sessionId: context.sessionId,
          stepId: step.stepId,
          status: "failed",
          error: error.message,
          isRecompute: resolvedContext?.type === "recompute",
          sourceTurnId: resolvedContext?.sourceTurnId,
        });
        
        // ✅ Critical: If main prompt fails, workflow cannot proceed
        this.port.postMessage({
          type: "WORKFLOW_COMPLETE",
          sessionId: context.sessionId,
          workflowId: request.workflowId,
          finalResults: Object.fromEntries(stepResults),
          error: "Main prompt step failed",
        });
        
        return; // Exit early
      }
    }
    
    // Continue with synthesis/mapping (similar error wrapping)...
    // [Rest of execute method continues as before]
    
  } catch (error) {
    console.error(`[WorkflowEngine] ❌ Critical workflow execution error:`, error);
    
    // ✅ Send error notification to UI
    this.port.postMessage({
      type: "WORKFLOW_COMPLETE",
      sessionId: context.sessionId,
      workflowId: request.workflowId,
      error: error.message || "A critical error occurred.",
    });
  } finally {
    // ✅ Always clean up delta cache
    clearDeltaCache(context.sessionId);
  }
}
