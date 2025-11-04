// src/core/workflow-engine.js - FIXED VERSION

// =============================================================================
// HELPER FUNCTIONS FOR PROMPT BUILDING
// =============================================================================

function buildSynthesisPrompt(originalPrompt, sourceResults, synthesisProvider, mappingResult = null) {
  console.log(`[WorkflowEngine] buildSynthesisPrompt called with:`, {
    originalPromptLength: originalPrompt?.length,
    sourceResultsCount: sourceResults?.length,
    synthesisProvider,
    hasMappingResult: !!mappingResult,
    mappingResultText: mappingResult?.text?.length
  });

  // Filter out only the synthesizing model's own response from batch outputs
  // Keep the mapping model's batch response - only exclude the separate mapping result
  const filteredResults = sourceResults.filter(res => {
    const isSynthesizer = res.providerId === synthesisProvider;
    return !isSynthesizer;
  });


  const otherItems = filteredResults
    .map(res => `**${(res.providerId || 'UNKNOWN').toUpperCase()}:**\n${String(res.text)}`);

  // Note: Mapping result is NOT added to otherItems to avoid duplication
  // It will only appear in the dedicated mapping section below

  const otherResults = otherItems.join('\n\n');
  const mappingSection = mappingResult ? `\n\n**CONFLICT RESOLUTION MAP:**\n${mappingResult.text}\n\n` : '';
  
  console.log(`[WorkflowEngine] Built synthesis prompt sections:`, {
    otherResultsLength: otherResults.length,
    mappingSectionLength: mappingSection.length,
    hasMappingSection: mappingSection.length > 0,
    mappingSectionPreview: mappingSection.substring(0, 100) + '...'
  });

  const finalPrompt = `Your task is to create the best possible response to the user's prompt leveraging all available outputs, resources and insights:

<original_user_query>
${originalPrompt}
</original_user_query>

Process:
1. Review your previous response from the conversation history above
2. Review all batch outputs from other models below
3. Review the conflict map to understand divergences and tensions
4. Extract the strongest ideas, insights, and approaches, treating your previous response as one equal source among the batch outputs, from ALL sources
5. Create a comprehensive answer that resolves the specific conflicts identified in the map

<conflict_map>
${mappingSection}
</conflict_map>

Output Requirements:
- Respond directly to the user's original question with the synthesized answer
- Integrate the most valuable elements from all sources, including your previous response, seamlessly as equals
- Present as a unified, coherent response rather than comparative analysis
- Aim for higher quality than any individual response by resolving the conflicts the map identified
- Do not analyze or compare the source outputs in your response

Additional Task - Options Inventory:
After your main synthesis, add a section with EXACTLY this delimiter:
"===ALL AVAILABLE OPTIONS==="
 Then add "Options" and 
- List ALL distinct approaches/solutions found across all models
- Groups similar ideas together under theme headers
- Summarize each in 1-2 sentences max
- Deduplicate semantically identical suggestions
- Orders from most to least mentioned/supported
Format as a clean, scannable list for quick reference

<model_outputs>
${otherResults}
</model_outputs>

Begin`;
  
  return finalPrompt;
}

function buildMappingPrompt(userPrompt, sourceResults) {
  const modelOutputsBlock = sourceResults
    .map(res => `=== ${String(res.providerId).toUpperCase()} ===\n${String(res.text)}`)
    .join('\n\n');

  return `You are not a synthesizer. You are a mirror that reveals what others cannot see.

Task: Present ALL insights from the model outputs below in their most useful form for decision-making on the user's prompt

<user_prompt>: ${String(userPrompt || "")} </user_prompt>

Critical instruction: Do NOT synthesize into a single answer. Instead, reason internally via this structure—then output ONLY as seamless, narrative prose that implicitly embeds it all:

**Map the landscape** — Group similar ideas, preserving tensions and contradictions.
**Surface the invisible** — Highlight consensus from 2+ models, unique sightings from one model as natural flow.
**Frame the choices** — present alternatives as "If you prioritize X, this path fits because Y."
**Flag the unknowns** — Note disagreements or uncertainties as subtle cautions.
**Anticipate the journey** — End with a subtle suggestion: "This naturally leads to questions about..." or "The next consideration might be..." based on the tensions and gaps identified.
**Internal format for reasoning - NEVER output directly:**
- What Everyone Sees, consensus
- The Tensions, disagreements
- The Unique Insights
- The Choice Framework
- Confidence Check

Finally output your response as a narrative explaining everything implicitly to the user, like a natural response to the user's prompt—fluid, insightful, redacting model names and extraneous details. Build feedback as emergent wisdom—evoke clarity, agency, and subtle awe. Weave your final narrative as representation of a cohesive response of the collective thought to the user's prompt

<model_outputs>:
${modelOutputsBlock}
</model_outputs>`;
}

// Track last seen text per provider/session for delta streaming
const lastStreamState = new Map();


function makeDelta(sessionId, providerId, fullText = "") {
  if (!sessionId) return fullText || "";
  
  const key = `${sessionId}:${providerId}`;
  const prev = lastStreamState.get(key) || "";
  let delta = "";

  // CASE 1: First emission (prev is empty) — always emit full text
  if (prev.length === 0 && fullText && fullText.length > 0) {
    delta = fullText;
    lastStreamState.set(key, fullText);
    logger.stream('First emission:', { providerId, textLength: fullText.length });
    return delta;
  }

  // CASE 2: Normal streaming append (new text added)
  if (fullText && fullText.length > prev.length) {
    // Find longest common prefix to handle small inline edits
    let prefixLen = 0;
    const minLen = Math.min(prev.length, fullText.length);
    
    while (prefixLen < minLen && prev[prefixLen] === fullText[prefixLen]) {
      prefixLen++;
    }
    
    // If common prefix >= 90% of previous text, treat as append
    if (prefixLen >= prev.length * 0.7) {
      delta = fullText.slice(prev.length);
      lastStreamState.set(key, fullText);
      logger.stream('Incremental append:', { providerId, deltaLen: delta.length });
    } else {
     logger.stream(`Divergence detected for ${providerId}: commonPrefix=${prefixLen}/${prev.length}`);
      lastStreamState.set(key, fullText);
      return fullText.slice(prefixLen); // ✅ Emit from divergence point
    }
    return delta;
  }

  // CASE 3: No change (duplicate call with same text) — no-op
  if (fullText === prev) {
    logger.stream('Duplicate call (no-op):', { providerId });
    return "";
  }

// CASE 4: Text got shorter - smart detection with warnings instead of errors
if (fullText.length < prev.length) {
    const regression = prev.length - fullText.length;
    
    // Calculate regression percentage
    const regressionPercent = (regression / prev.length) * 100;
    
    // ✅ Allow small absolute regressions OR small percentage regressions
    const isSmallRegression = regression <= 200 || regressionPercent <= 5;
    
    if (isSmallRegression) {
      logger.stream(`Acceptable regression for ${providerId}:`, { 
        chars: regression, 
        percent: regressionPercent.toFixed(1) + '%' 
      });
      lastStreamState.set(key, fullText);
      return "";
    }
  
  // Flag & throttle: only warn if DEBUG_STREAMING=true, or log once per provider/session
  if (process.env.DEBUG_STREAMING === 'true') {  // Or your global DEBUG_WORKFLOW
    // Optional: debounce per-provider (e.g., Map of lastWarn ts)
    const now = Date.now();
    const lastWarnKey = `${key}:lastRegressionWarn`;
    const lastWarn = lastStreamState.get(lastWarnKey) || 0;
    if (now - lastWarn > 5000) {  // 5s cooldown per provider
      logger.warn(`[makeDelta] Significant text regression for ${providerId}:`, { 
        prevLen: prev.length, 
        fullLen: fullText.length,
        regression,
        regressionPercent: regressionPercent.toFixed(1) + '%'
      });
      lastStreamState.set(lastWarnKey, now);
    }
  }
  lastStreamState.set(key, fullText);  // Still update state
  return "";  // No emit on regression
}

  // CASE 5: Fallback (shouldn't reach here, but safe default)
  return "";
}

/**
 * Clear delta cache when session ends (prevents memory leaks)
 */
function clearDeltaCache(sessionId) {
  if (!sessionId) return;
  
  const keysToDelete = [];
  lastStreamState.forEach((_, key) => {
    if (key.startsWith(`${sessionId}:`)) {
      keysToDelete.push(key);
    }
  });
  
  keysToDelete.forEach(key => lastStreamState.delete(key));
  logger.debug(`[makeDelta] Cleared ${keysToDelete.length} cache entries for session ${sessionId}`);
}
// =============================================================================
// SMART CONSOLE FILTER FOR DEV TOOLS
// =============================================================================

const STREAMING_DEBUG = false; // ✅ Set to true to see streaming deltas

/**
 * Filtered logger: Hides streaming noise unless explicitly enabled
 */
const logger = {
  // Streaming-specific logs (hidden by default)
  stream: (...args) => {
    if (STREAMING_DEBUG) console.debug('[STREAM]', ...args);
  },
  
  // Always show these
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console)
};
// =============================================================================
// WORKFLOW ENGINE - FIXED
// =============================================================================

export class WorkflowEngine {
  constructor(orchestrator, sessionManager, port) {
    this.orchestrator = orchestrator;
    this.sessionManager = sessionManager;
    this.port = port;
    // Keep track of the most recent finalized turn to align IDs with persistence
    this._lastFinalizedTurn = null;
  }

  async execute(request, resolvedContext) {
    const { context, steps } = request;
    const stepResults = new Map();
    // In-memory per-workflow cache of provider contexts created by batch steps
    const workflowContexts = {};

    // Cache current user message for persistence usage
    this.currentUserMessage = context?.userMessage || this.currentUserMessage || '';

    // Ensure session exists
    // Session ID must be provided by the connection handler or compiler.
    // We no longer emit SESSION_STARTED; TURN_CREATED now carries the authoritative sessionId.
    if (!context.sessionId || context.sessionId === 'new-session') {
      // As a conservative fallback, ensure a non-empty sessionId is present.
      context.sessionId = context.sessionId && context.sessionId !== 'new-session'
        ? context.sessionId
        : `sid-${Date.now()}`;
      // NOTE: Do not post SESSION_STARTED. UI initializes session from TURN_CREATED.
    }

    try {
      // ========================================================================
      // NEW: Seed frozen outputs for recompute
      // ========================================================================
      if (resolvedContext && resolvedContext.type === 'recompute') {
        console.log('[WorkflowEngine] Seeding frozen batch outputs for recompute');
        try {
          // Seed a synthetic batch step result so downstream mapping/synthesis can reference it
          stepResults.set('batch', {
            status: 'completed',
            result: { results: resolvedContext.frozenBatchOutputs }
          });
        } catch (e) {
          console.warn('[WorkflowEngine] Failed to seed frozen batch outputs:', e);
        }

        // Cache historical contexts for providers at the source turn
        try {
          Object.entries(resolvedContext.providerContextsAtSourceTurn || {}).forEach(([pid, ctx]) => {
            if (ctx && typeof ctx === 'object') {
              workflowContexts[pid] = ctx;
            }
          });
        } catch (e) {
          console.warn('[WorkflowEngine] Failed to cache historical provider contexts:', e);
        }
      }

      const promptSteps = steps.filter(step => step.type === 'prompt');
      const synthesisSteps = steps.filter(step => step.type === 'synthesis');
      const mappingSteps = steps.filter(step => step.type === 'mapping');

        // 1. Execute all batch prompt steps first, as they are dependencies.
    for (const step of promptSteps) {
        try {
            const result = await this.executePromptStep(step, context);
            stepResults.set(step.stepId, { status: 'completed', result });
            this.port.postMessage({ type: 'WORKFLOW_STEP_UPDATE', sessionId: context.sessionId, stepId: step.stepId, status: 'completed', result });

            // Cache provider contexts from this batch step into workflowContexts so
            // subsequent synthesis/mapping steps in the same workflow can continue
            // the freshly-created conversations immediately.
            try {
              const resultsObj = result && result.results ? result.results : {};
              Object.entries(resultsObj).forEach(([pid, data]) => {
                if (data && data.meta && Object.keys(data.meta).length > 0) {
                  workflowContexts[pid] = data.meta;
                  console.log(`[WorkflowEngine] Cached context for ${pid}: ${Object.keys(data.meta).join(',')}`);
                }
              });
            } catch (e) { /* best-effort logging */ }
        } catch (error) {
            console.error(`[WorkflowEngine] Prompt step ${step.stepId} failed:`, error);
            stepResults.set(step.stepId, { status: 'failed', error: error.message });
            this.port.postMessage({ type: 'WORKFLOW_STEP_UPDATE', sessionId: context.sessionId, stepId: step.stepId, status: 'failed', error: error.message });
                // If the main prompt fails, the entire workflow cannot proceed.
                this.port.postMessage({ type: 'WORKFLOW_COMPLETE', sessionId: context.sessionId, workflowId: request.workflowId, finalResults: Object.fromEntries(stepResults) });
                return; // Exit early
        }
    }

        // 2. Execute mapping steps first (they must complete before synthesis)
    for (const step of mappingSteps) {
        try {
            const result = await this.executeMappingStep(step, context, stepResults, workflowContexts, resolvedContext);
            stepResults.set(step.stepId, { status: 'completed', result });
            this.port.postMessage({ type: 'WORKFLOW_STEP_UPDATE', sessionId: context.sessionId, stepId: step.stepId, status: 'completed', result });
        } catch (error) {
            console.error(`[WorkflowEngine] Mapping step ${step.stepId} failed:`, error);
            stepResults.set(step.stepId, { status: 'failed', error: error.message });
            this.port.postMessage({ type: 'WORKFLOW_STEP_UPDATE', sessionId: context.sessionId, stepId: step.stepId, status: 'failed', error: error.message });
            // Continue with other mapping steps even if one fails
        }
    }

        // 3. Execute synthesis steps (now they can access completed mapping results)
    for (const step of synthesisSteps) {
        try {
            const result = await this.executeSynthesisStep(step, context, stepResults, workflowContexts, resolvedContext);
            stepResults.set(step.stepId, { status: 'completed', result });
            this.port.postMessage({ type: 'WORKFLOW_STEP_UPDATE', sessionId: context.sessionId, stepId: step.stepId, status: 'completed', result });
        } catch (error) {
            console.error(`[WorkflowEngine] Synthesis step ${step.stepId} failed:`, error);
            stepResults.set(step.stepId, { status: 'failed', error: error.message });
            this.port.postMessage({ type: 'WORKFLOW_STEP_UPDATE', sessionId: context.sessionId, stepId: step.stepId, status: 'failed', error: error.message });
            // Continue with other synthesis steps even if one fails
        }
    }
    
        // ========================================================================
        // Persistence: Call new primitive-based method
        // ========================================================================
        try {
          await this._persistCriticalTurnData(context, steps, stepResults, resolvedContext);
        } catch (e) {
          console.error('[WorkflowEngine] CRITICAL persistence failed:', e);
          // Still notify UI to avoid hanging
        }

        // 2) Signal completion to the UI (unchanged message shape)
        this.port.postMessage({ type: 'WORKFLOW_COMPLETE', sessionId: context.sessionId, workflowId: request.workflowId, finalResults: Object.fromEntries(stepResults) });
        
        // Emit canonical turn to allow UI to replace optimistic placeholders
        this._emitTurnFinalized(context, steps, stepResults);
        
        // ✅ Clean up delta cache
        clearDeltaCache(context.sessionId);

        // 3) Defer NON-CRITICAL persistence (mapping/synthesis responses, secondary context updates)
        setTimeout(() => {
          this._persistNonCriticalData(context, steps, stepResults, resolvedContext).catch(e => {
            console.warn('[WorkflowEngine] Deferred non-critical persistence failed:', e);
          });
        }, 0);
        
} catch (error) {
        console.error(`[WorkflowEngine] Critical workflow execution error:`, error);
        this.port.postMessage({ type: 'WORKFLOW_COMPLETE', sessionId: context.sessionId, workflowId: request.workflowId, error: 'A critical error occurred.' });
}
  }

  /**
   * Emit TURN_FINALIZED message with canonical turn data
   * This allows UI to replace optimistic placeholders with backend-confirmed data
   */
  _emitTurnFinalized(context, steps, stepResults) {
    // Skip for historical reruns (they don't create new user turns)
    if (context?.targetUserTurnId) {
      console.log('[WorkflowEngine] Skipping TURN_FINALIZED for historical rerun');
      return;
    }

    const userMessage = context?.userMessage || this.currentUserMessage || '';
    if (!userMessage) {
      return;
    }

    try {
      // Build canonical turn structure
      const timestamp = Date.now();
      // Prefer canonical IDs passed from connection-handler
      const userTurnId = context?.canonicalUserTurnId || this._generateId('user');
      const aiTurnId = context?.canonicalAiTurnId || this._generateId('ai');

      const userTurn = {
        id: userTurnId,
        type: 'user',
        text: userMessage,
        createdAt: timestamp,
        sessionId: context.sessionId
      };

      // Collect AI results from step results
      const batchResponses = {};
      const synthesisResponses = {};
      const mappingResponses = {};

      const stepById = new Map((steps || []).map(s => [s.stepId, s]));
      stepResults.forEach((value, stepId) => {
        const step = stepById.get(stepId);
        if (!step || value?.status !== 'completed') return;
        const result = value.result;

        switch (step.type) {
          case 'prompt': {
            const resultsObj = result?.results || {};
            Object.entries(resultsObj).forEach(([providerId, r]) => {
              batchResponses[providerId] = {
                providerId,
                text: r.text || '',
                status: r.status || 'completed',
                createdAt: timestamp,
                updatedAt: timestamp,
                meta: r.meta || {}
              };
            });
            break;
          }
          case 'synthesis': {
            const providerId = result?.providerId;
            if (!providerId) return;
            if (!synthesisResponses[providerId]) synthesisResponses[providerId] = [];
            synthesisResponses[providerId].push({
              providerId,
              text: result?.text || '',
              status: result?.status || 'completed',
              createdAt: timestamp,
              updatedAt: timestamp,
              meta: result?.meta || {}
            });
            break;
          }
          case 'mapping': {
            const providerId = result?.providerId;
            if (!providerId) return;
            if (!mappingResponses[providerId]) mappingResponses[providerId] = [];
            mappingResponses[providerId].push({
              providerId,
              text: result?.text || '',
              status: result?.status || 'completed',
              createdAt: timestamp,
              updatedAt: timestamp,
              meta: result?.meta || {}
            });
            break;
          }
        }
      });

      const hasData = Object.keys(batchResponses).length > 0 || 
                      Object.keys(synthesisResponses).length > 0 || 
                      Object.keys(mappingResponses).length > 0;

      if (!hasData) {
        console.log('[WorkflowEngine] No AI responses to finalize');
        return;
      }

      const aiTurn = {
        id: aiTurnId,
        type: 'ai',
        userTurnId: userTurn.id,
        sessionId: context.sessionId,
        threadId: 'default-thread',
        createdAt: timestamp,
        batchResponses,
        synthesisResponses,
        mappingResponses
      };

      console.log('[WorkflowEngine] Emitting TURN_FINALIZED', {
        userTurnId: userTurn.id,
        aiTurnId: aiTurn.id,
        batchCount: Object.keys(batchResponses).length,
        synthesisCount: Object.keys(synthesisResponses).length,
        mappingCount: Object.keys(mappingResponses).length
      });

      this.port.postMessage({
        type: 'TURN_FINALIZED',
        sessionId: context.sessionId,
        userTurnId: userTurn.id,
        aiTurnId: aiTurn.id,
        turn: {
          user: userTurn,
          ai: aiTurn
        }
      });

      // Store for persistence alignment
      this._lastFinalizedTurn = {
        sessionId: context.sessionId,
        user: userTurn,
        ai: aiTurn
      };
    } catch (error) {
      console.error('[WorkflowEngine] Failed to emit TURN_FINALIZED:', error);
    }
  }

  /**
   * Persist only CRITICAL data needed for historical reruns and stable turn IDs.
   * - For new/continued conversations: persist user turn + AI turn with batch responses only
   * - For historical reruns: do nothing here (non-critical path will append responses)
   */
  async _persistCriticalTurnData(context, steps, stepResults, resolvedContext) {
    // Skip for historical reruns (no new turn created)
    if (context?.targetUserTurnId) {
      console.log('[WorkflowEngine] Skipping critical persistence (historical rerun)');
      return;
    }

    const userMessage = context?.userMessage || this.currentUserMessage || '';
    if (!userMessage) {
      console.log('[WorkflowEngine] Skipping persistence (no user message)');
      return;
    }

    try {
      // ========================================================================
      // Extract results from step execution
      // ========================================================================
      const result = {
        batchOutputs: {},
        synthesisOutputs: {},
        mappingOutputs: {}
      };
      const stepById = new Map((steps || []).map(s => [s.stepId, s]));
      stepResults.forEach((stepResult, stepId) => {
        if (stepResult.status !== 'completed') return;
        const step = stepById.get(stepId);
        if (!step) return;
        if (step.type === 'prompt') {
          result.batchOutputs = stepResult.result?.results || {};
        } else if (step.type === 'synthesis') {
          const providerId = step.payload.synthesisProvider;
          if (providerId) result.synthesisOutputs[providerId] = stepResult.result;
        } else if (step.type === 'mapping') {
          const providerId = step.payload.mappingProvider;
          if (providerId) result.mappingOutputs[providerId] = stepResult.result;
        }
      });

      // ========================================================================
      // Construct request object for persistence
      // ========================================================================
      const request = {
        type: resolvedContext?.type || 'unknown',
        sessionId: context.sessionId,
        userMessage
      };
      if (resolvedContext?.type === 'recompute') {
        request.sourceTurnId = resolvedContext.sourceTurnId;
        request.stepType = resolvedContext.stepType;
        request.targetProvider = resolvedContext.targetProvider;
      }

      // Prefer the canonical IDs chosen by connection-handler if present
      if (context?.canonicalUserTurnId) request.canonicalUserTurnId = context.canonicalUserTurnId;
      if (context?.canonicalAiTurnId) request.canonicalAiTurnId = context.canonicalAiTurnId;

      console.log(`[WorkflowEngine] Persisting ${request.type} workflow to SessionManager`);

      // Call new primitive-based persist method
      const persistResult = await this.sessionManager.persist(request, resolvedContext, result);

      // Update workflow context with canonical IDs (and sessionId for initialize)
      if (persistResult) {
        if (persistResult.userTurnId) context.canonicalUserTurnId = persistResult.userTurnId;
        if (persistResult.aiTurnId) context.canonicalAiTurnId = persistResult.aiTurnId;
        if (resolvedContext?.type === 'initialize' && persistResult.sessionId) {
          context.sessionId = persistResult.sessionId;
          console.log(`[WorkflowEngine] Initialize complete: session=${persistResult.sessionId}`);
        }
      }
    } catch (error) {
      console.error('[WorkflowEngine] Critical persistence failed:', error);
      throw error;
    }
  }

  /**
   * Persist NON-CRITICAL data in the background:
   * - Append synthesis/mapping responses to the persisted AI turn
   * - Optionally update session metadata
   */
  async _persistNonCriticalData(context, steps, stepResults, resolvedContext) {
    // Build additions from synthesis/mapping step results
    const synthesisResponses = {};
    const mappingResponses = {};
    try {
      const stepById = new Map((steps || []).map(s => [s.stepId, s]));
      stepResults.forEach((value, stepId) => {
        const step = stepById.get(stepId);
        if (!step || value?.status !== 'completed') return;
        const result = value.result;
        if (step.type === 'synthesis') {
          const providerId = result?.providerId;
          if (!providerId) return;
          const entry = { providerId, text: result?.text || '', status: result?.status || 'completed', meta: result?.meta || {} };
          if (!synthesisResponses[providerId]) synthesisResponses[providerId] = [];
          synthesisResponses[providerId].push(entry);
        } else if (step.type === 'mapping') {
          const providerId = result?.providerId;
          if (!providerId) return;
          const entry = { providerId, text: result?.text || '', status: result?.status || 'completed', meta: result?.meta || {} };
          if (!mappingResponses[providerId]) mappingResponses[providerId] = [];
          mappingResponses[providerId].push(entry);
        }
      });
    } catch (_) {}

    const additions = {};
    if (Object.keys(synthesisResponses).length > 0) additions.synthesisResponses = synthesisResponses;
    if (Object.keys(mappingResponses).length > 0) additions.mappingResponses = mappingResponses;
    if (Object.keys(additions).length === 0) return; // Nothing to do

    // Historical reruns append to the existing AI turn following targetUserTurnId
    if (context?.targetUserTurnId) {
      await this.sessionManager.appendProviderResponses(context.sessionId, context.targetUserTurnId, additions);
      await this.sessionManager.saveSession(context.sessionId);
      return;
    }

    // New/continued conversation: append to the AI turn saved in critical phase
    const userTurnId = context?.canonicalUserTurnId;
    if (!userTurnId) {
      console.warn('[WorkflowEngine] No canonicalUserTurnId present; cannot append non-critical responses');
      return;
    }
    await this.sessionManager.appendProviderResponses(context.sessionId, userTurnId, additions);
    await this.sessionManager.saveSession(context.sessionId);
  }

  /**
   * Persist a completed user/ai turn pair to the SessionManager.
   * Skips persistence for historical reruns (targetUserTurnId present).
   */
  _persistCompletedTurn(context, steps, stepResults) {
    // For historical reruns, append mapping/synthesis results to the existing AI turn
    if (context?.targetUserTurnId) {
      try {
        // Collect provider outputs from this workflow
        const batchResponses = {};
        const synthesisResponses = {};
        const mappingResponses = {};

        const stepById = new Map((steps || []).map(s => [s.stepId, s]));
        stepResults.forEach((value, stepId) => {
          const step = stepById.get(stepId);
          if (!step || value?.status !== 'completed') return;
          const result = value.result;
          switch (step.type) {
            case 'prompt': {
              const resultsObj = result?.results || {};
              Object.entries(resultsObj).forEach(([providerId, r]) => {
                batchResponses[providerId] = {
                  providerId,
                  text: r.text || '',
                  status: r.status || 'completed',
                  meta: r.meta || {}
                };
              });
              break;
            }
            case 'synthesis': {
              const providerId = result?.providerId;
              if (!providerId) return;
              const entry = { providerId, text: result?.text || '', status: result?.status || 'completed', meta: result?.meta || {} };
              if (!synthesisResponses[providerId]) synthesisResponses[providerId] = [];
              synthesisResponses[providerId].push(entry);
              break;
            }
            case 'mapping': {
              const providerId = result?.providerId;
              if (!providerId) return;
              const entry = { providerId, text: result?.text || '', status: result?.status || 'completed', meta: result?.meta || {} };
              if (!mappingResponses[providerId]) mappingResponses[providerId] = [];
              mappingResponses[providerId].push(entry);
              break;
            }
          }
        });

        const additions = {};
        if (Object.keys(batchResponses).length > 0) additions.batchResponses = batchResponses;
        if (Object.keys(synthesisResponses).length > 0) additions.synthesisResponses = synthesisResponses;
        if (Object.keys(mappingResponses).length > 0) additions.mappingResponses = mappingResponses;

        if (Object.keys(additions).length > 0) {
          this.sessionManager.appendProviderResponses(context.sessionId, context.targetUserTurnId, additions);
        }
      } catch (e) {
        console.warn('[WorkflowEngine] Failed to append historical provider responses:', e);
      }
      return;
    }

    const userMessage = context?.userMessage || this.currentUserMessage || '';
    if (!userMessage) return; // No content to persist

    // If we have a recently finalized turn for this session, persist it directly to keep IDs stable
    if (this._lastFinalizedTurn && this._lastFinalizedTurn.sessionId === context.sessionId) {
      try {
        this.sessionManager.saveTurn(context.sessionId, this._lastFinalizedTurn.user, this._lastFinalizedTurn.ai);
      } catch (e) {
        console.warn('[WorkflowEngine] Failed to persist last finalized turn, falling back to rebuild:', e);
      } finally {
        this._lastFinalizedTurn = null; // Clear regardless to avoid cross-run leaks
      }
      return;
    }

    // Build UserTurn
    const timestamp = Date.now();
    const userTurnId = context?.canonicalUserTurnId || this._generateId('user');
    const userTurn = {
      type: 'user',
      id: userTurnId,
      text: userMessage,
      createdAt: timestamp
    };

    // Collect AI results
    const batchResponses = {};
    const synthesisResponses = {};
    const mappingResponses = {};

    const stepById = new Map((steps || []).map(s => [s.stepId, s]));
    stepResults.forEach((value, stepId) => {
      const step = stepById.get(stepId);
      if (!step || value?.status !== 'completed') return;
      const result = value.result;
      switch (step.type) {
        case 'prompt': {
          const resultsObj = result?.results || {};
          Object.entries(resultsObj).forEach(([providerId, r]) => {
            batchResponses[providerId] = {
              providerId,
              text: r.text || '',
              status: r.status || 'completed',
              meta: r.meta || {}
            };
          });
          break;
        }
        case 'synthesis': {
          const providerId = result?.providerId;
          if (!providerId) return;
          const entry = {
            providerId,
            text: result?.text || '',
            status: result?.status || 'completed',
            meta: result?.meta || {}
          };
          if (!synthesisResponses[providerId]) synthesisResponses[providerId] = [];
          synthesisResponses[providerId].push(entry);
          break;
        }
        case 'mapping': {
          const providerId = result?.providerId;
          if (!providerId) return;
          const entry = {
            providerId,
            text: result?.text || '',
            status: result?.status || 'completed',
            meta: result?.meta || {}
          };
          if (!mappingResponses[providerId]) mappingResponses[providerId] = [];
          mappingResponses[providerId].push(entry);
          break;
        }
      }
    });

    const hasData = Object.keys(batchResponses).length > 0 || Object.keys(synthesisResponses).length > 0 || Object.keys(mappingResponses).length > 0;
    if (!hasData) return; // Nothing to persist

    // Build AiTurn
    const aiTurn = {
      type: 'ai',
      id: context?.canonicalAiTurnId || this._generateId('ai'),
      createdAt: Date.now(),
      userTurnId: userTurn.id,
      batchResponses,
      synthesisResponses,
      mappingResponses
    };

    this.sessionManager.saveTurn(context.sessionId, userTurn, aiTurn);
  }

  _generateId(prefix = 'turn') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Resolves provider context using three-tier resolution:
   * 1. Workflow cache context (highest priority)
   * 2. Batch step context (medium priority)
   * 3. Persisted context (fallback)
   */
  _resolveProviderContext(providerId, context, payload, workflowContexts, previousResults, resolvedContext, stepType = 'step') {
    const providerContexts = {};

    // Tier 1: Prefer workflow cache context produced within this workflow run
    if (workflowContexts && workflowContexts[providerId]) {
      providerContexts[providerId] = {
        meta: workflowContexts[providerId],
        continueThread: true
      };
      try {
        console.log(`[WorkflowEngine] ${stepType} using workflow-cached context for ${providerId}: ${Object.keys(workflowContexts[providerId]).join(',')}`);
      } catch (_) {}
      return providerContexts;
    }

    // Tier 2: ResolvedContext (for recompute - historical contexts)
    if (resolvedContext && resolvedContext.type === 'recompute') {
      const historicalContext = resolvedContext.providerContextsAtSourceTurn?.[providerId];
      if (historicalContext) {
        providerContexts[providerId] = {
          meta: historicalContext,
          continueThread: true
        };
        try {
          console.log(`[WorkflowEngine] ${stepType} using historical context from ResolvedContext for ${providerId}`);
        } catch (_) {}
        return providerContexts;
      }
    }

    // Tier 2: Fallback to batch step context for backwards compatibility
    if (payload.continueFromBatchStep) {
      const batchResult = previousResults.get(payload.continueFromBatchStep);
      if (batchResult?.status === 'completed' && batchResult.result?.results) {
        const providerResult = batchResult.result.results[providerId];
        if (providerResult?.meta) {
          providerContexts[providerId] = {
            meta: providerResult.meta,
            continueThread: true
          };
          try {
            console.log(`[WorkflowEngine] ${stepType} continuing conversation for ${providerId} via batch step`);
          } catch (_) {}
          return providerContexts;
        }
      }
    }

    // Tier 3: Last resort use persisted context (may be stale across workflow runs)
    try {
      const persisted = this.sessionManager.getProviderContexts(context.sessionId, context.threadId || 'default-thread');
      const persistedMeta = persisted?.[providerId]?.meta;
      if (persistedMeta && Object.keys(persistedMeta).length > 0) {
        providerContexts[providerId] = {
          meta: persistedMeta,
          continueThread: true
        };
        try {
          console.log(`[WorkflowEngine] ${stepType} using persisted context for ${providerId}: ${Object.keys(persistedMeta).join(',')}`);
        } catch (_) {}
        return providerContexts;
      }
    } catch (_) {}

    return providerContexts;
  }

  // ==========================================================================
  // STEP EXECUTORS - FIXED
  // ==========================================================================

  /**
   * Execute prompt step - FIXED to return proper format
   */
  async executePromptStep(step, context) {
    const { prompt, providers, useThinking, providerContexts } = step.payload;
    
    return new Promise((resolve, reject) => {
      this.orchestrator.executeParallelFanout(prompt, providers, {
        sessionId: context.sessionId,
        useThinking,
        providerContexts,
        // Pass providerMeta through to orchestrator for adapters (e.g., gemini model selection)
        providerMeta: step?.payload?.providerMeta,
        onPartial: (providerId, chunk) => {
  const delta = makeDelta(context.sessionId, providerId, chunk.text);
  
  // ✅ Only dispatch non-empty deltas
  if (delta && delta.length > 0) {
    this.port.postMessage({ 
      type: 'PARTIAL_RESULT', 
      sessionId: context.sessionId, 
      stepId: step.stepId, 
      providerId, 
      chunk: { text: delta } 
    });
    logger.stream('Delta dispatched:', { stepId: step.stepId, providerId, len: delta.length });
  } else {
    logger.stream('Delta skipped (empty):', { stepId: step.stepId, providerId });
  }
},
         // ========= START: RECOMMENDED IMPLEMENTATION (STEP 3) ========= 
         onAllComplete: (results, errors) => { 
           // `results` now contains successfully resolved providers (including soft-errors) 
           // `errors` contains providers that failed hard (e.g., not found, network error before streaming) 
           
           // Persist contexts for all successful providers 
           results.forEach((res, pid) => { 
             this.sessionManager.updateProviderContext( 
               context.sessionId, 
               pid, 
               res, 
               true, 
               { skipSave: true } 
             ); 
           }); 
           this.sessionManager.saveSession(context.sessionId); 
           
           // ... (final emission logic for non-streaming providers remains the same) ... 
 
           const formattedResults = {}; 
           
           // Process successful results 
           results.forEach((result, providerId) => { 
             const hasText = result.text && result.text.trim().length > 0; 
             formattedResults[providerId] = { 
               providerId: providerId, 
               text: result.text || '', 
               // A successful result from the orchestrator always has 'completed' status now 
               status: 'completed', 
               meta: result.meta || {}, 
               // Explicitly include the softError if it was normalized by the orchestrator 
               ...(result.softError ? { softError: result.softError } : {}) 
             }; 
           }); 
           
           // Process hard errors 
           errors.forEach((error, providerId) => { 
             formattedResults[providerId] = { 
               providerId: providerId, 
               text: '', 
               status: 'failed', 
               meta: { _rawError: error.message } 
             }; 
           }); 
 
           // Check if AT LEAST ONE provider produced usable text. 
           const hasAnyValidResults = Object.values(formattedResults).some( 
             r => r.status === 'completed' && r.text && r.text.trim().length > 0 
           ); 
 
           if (!hasAnyValidResults) { 
             // Only reject if the entire batch produced absolutely no text. 
             reject(new Error('All providers failed or returned empty responses')); 
             return; 
           } 
           
           // Resolve with the complete picture of the batch execution. 
           // Downstream steps like synthesis will naturally filter for 'completed' status. 
           resolve({ 
             results: formattedResults, 
             // We can still pass along hard errors for logging if needed 
             errors: Object.fromEntries(errors) 
           }); 
         } 
         // ========= END: RECOMMENDED IMPLEMENTATION ========= 
       });
    });
  }

  /**
   * Resolve source data - FIXED to handle new format
   */
  async resolveSourceData(payload, context, previousResults) {
    // removed low-value entry log

    if (payload.sourceHistorical) {
      // Historical source
      const { turnId: userTurnId, responseType } = payload.sourceHistorical;
      console.log(`[WorkflowEngine] Resolving historical data from turn: ${userTurnId}`);
      
      // Prefer current session
      let session = this.sessionManager.sessions[context.sessionId];
      let aiTurn = null;
      if (session && Array.isArray(session.turns)) {
        const userTurnIndex = session.turns.findIndex(t => t.id === userTurnId && t.type === 'user');
        if (userTurnIndex !== -1) {
          aiTurn = session.turns[userTurnIndex + 1];
        }
      }
      // Fallback: search across all sessions (helps after reconnects or wrong session targeting)
      if (!aiTurn) {
        try {
          const allSessions = this.sessionManager.sessions || {};
          for (const [sid, s] of Object.entries(allSessions)) {
            if (!s || !Array.isArray(s.turns)) continue;
            const idx = s.turns.findIndex(t => t.id === userTurnId && t.type === 'user');
            if (idx !== -1) {
              aiTurn = s.turns[idx + 1];
              session = s;
              console.warn(`[WorkflowEngine] Historical turn ${userTurnId} found in different session ${sid}; proceeding with that context.`);
              break;
            }
          }
        } catch (_) {}
      }
      if (!aiTurn || aiTurn.type !== 'ai') {
        // Fallback: try to resolve by matching user text when IDs differ (optimistic vs canonical)
        const fallbackText = context?.userMessage || this.currentUserMessage || '';
        if (fallbackText && fallbackText.trim().length > 0) {
          try {
            // Search current session first
            let found = null;
            const searchInSession = (sess) => {
              if (!sess || !Array.isArray(sess.turns)) return null;
              for (let i = 0; i < sess.turns.length; i++) {
                const t = sess.turns[i];
                if (t && t.type === 'user' && String(t.text || '') === String(fallbackText)) {
                  const next = sess.turns[i + 1];
                  if (next && next.type === 'ai') return next;
                }
              }
              return null;
            };

            found = searchInSession(session);
            if (!found) {
              // Fallback: search across all sessions
              const allSessions = this.sessionManager.sessions || {};
              for (const [sid, s] of Object.entries(allSessions)) {
                found = searchInSession(s);
                if (found) {
                  console.warn(`[WorkflowEngine] Historical fallback matched by text in different session ${sid}; proceeding with that context.`);
                  break;
                }
              }
            }

            if (found) {
              aiTurn = found;
            } else {
              throw new Error(`Could not find corresponding AI turn for ${userTurnId}`);
            }
          } catch (e) {
            throw new Error(`Could not find corresponding AI turn for ${userTurnId}`);
          }
        } else {
          throw new Error(`Could not find corresponding AI turn for ${userTurnId}`);
        }
      }
      
      let sourceContainer;
      switch(responseType) {
        case 'synthesis': 
          sourceContainer = aiTurn.synthesisResponses || {}; 
          break;
        case 'mapping': 
          sourceContainer = aiTurn.mappingResponses || {}; 
          break;
        default: 
          sourceContainer = aiTurn.batchResponses || {}; 
          break;
      }
      
      // Convert to array format
      const sourceArray = Object.values(sourceContainer)
        .flat()
        .filter(res => res.status === 'completed' && res.text && res.text.trim().length > 0)
        .map(res => ({
          providerId: res.providerId,
          text: res.text
        }));

      console.log(`[WorkflowEngine] Found ${sourceArray.length} historical sources`);
      return sourceArray;

    } else if (payload.sourceStepIds) {
      // Current workflow source
      const sourceArray = [];
      
      for (const stepId of payload.sourceStepIds) {
        const stepResult = previousResults.get(stepId);
        
        if (!stepResult || stepResult.status !== 'completed') {
          console.warn(`[WorkflowEngine] Step ${stepId} not found or incomplete`);
          continue;
        }

        const { results } = stepResult.result;
        // removed low-value current-source log
        
        // Results is now an object: { claude: {...}, gemini: {...} }
        Object.entries(results).forEach(([providerId, result]) => {
          if (result.status === 'completed' && result.text && result.text.trim().length > 0) {
            sourceArray.push({
              providerId: providerId,
              text: result.text
            });
          }
        });
      }

      console.log(`[WorkflowEngine] Found ${sourceArray.length} current workflow sources`);
      return sourceArray;
    }
    
    throw new Error('No valid source specified for step.');
  }

  /**
   * Execute synthesis step - FIXED error messages
   */
  async executeSynthesisStep(step, context, previousResults, workflowContexts = {}, resolvedContext) {
    const payload = step.payload;
    const sourceData = await this.resolveSourceData(payload, context, previousResults);
    
    if (sourceData.length === 0) {
      throw new Error("No valid sources for synthesis. All providers returned empty or failed responses.");
    }

    console.log(`[WorkflowEngine] Running synthesis with ${sourceData.length} sources:`, 
      sourceData.map(s => s.providerId).join(', '));

    // Look for mapping results from the current workflow
    let mappingResult = null;
    // removed verbose payload/key echo logs
    
    if (payload.mappingStepIds && payload.mappingStepIds.length > 0) {
      for (const mappingStepId of payload.mappingStepIds) {
        const mappingStepResult = previousResults.get(mappingStepId);
        console.log(`[WorkflowEngine] Checking mapping step ${mappingStepId}:`, mappingStepResult);
        
        if (mappingStepResult?.status === 'completed' && mappingStepResult.result?.text) {
          mappingResult = mappingStepResult.result;
          console.log(`[WorkflowEngine] Found mapping result from step ${mappingStepId} for synthesis:`, {
            providerId: mappingResult.providerId,
            textLength: mappingResult.text?.length,
            textPreview: mappingResult.text?.substring(0, 100) + '...'
          });
          break;
        } else {
          console.log(`[WorkflowEngine] Mapping step ${mappingStepId} not suitable:`, {
            status: mappingStepResult?.status,
            hasResult: !!mappingStepResult?.result,
            hasText: !!mappingStepResult?.result?.text,
            textLength: mappingStepResult?.result?.text?.length
          });
        }
      }
      // Enforce presence of mapping output when mapping steps are declared
      if (!mappingResult || !String(mappingResult.text || '').trim()) {
        console.error(`[WorkflowEngine] No valid mapping result found. mappingResult:`, mappingResult);
        throw new Error('Synthesis requires a completed Map result; none found.');
      }
    } else {
      // no mappingStepIds configured for synthesis step
      // Historical synthesis case: attempt to retrieve a prior mapping result
      if (!mappingResult && payload.sourceHistorical?.turnId) {
        try {
          const userTurnId = payload.sourceHistorical.turnId;
          // Locate the historical AI turn (reuse logic from resolveSourceData)
          let session = this.sessionManager.sessions[context.sessionId];
          let aiTurn = null;
          if (session && Array.isArray(session.turns)) {
            const userTurnIndex = session.turns.findIndex(t => t.id === userTurnId && t.type === 'user');
            if (userTurnIndex !== -1) {
              aiTurn = session.turns[userTurnIndex + 1];
            }
          }
          if (!aiTurn) {
            const allSessions = this.sessionManager.sessions || {};
            for (const [sid, s] of Object.entries(allSessions)) {
              if (!s || !Array.isArray(s.turns)) continue;
              const idx = s.turns.findIndex(t => t.id === userTurnId && t.type === 'user');
              if (idx !== -1) {
                aiTurn = s.turns[idx + 1];
                session = s;
                console.warn(`[WorkflowEngine] (Synthesis) Using mapping from historical session ${sid}`);
                break;
              }
            }
          }
          if (aiTurn && aiTurn.type === 'ai') {
            let maps = aiTurn.mappingResponses || {};
            // Legacy fallback removed: engine trusts ResolvedContext and current session data
            // Pick the most recent mapping entry across providers (fallback: first available)
            let candidate = null;
            let candidatePid = null;
            for (const [pid, arr] of Object.entries(maps)) {
              if (Array.isArray(arr) && arr.length > 0) {
                const last = arr[arr.length - 1];
                if (last && String(last.text || '').trim()) {
                  candidate = last; candidatePid = pid;
                }
              }
            }
            if (!candidate && this.sessionManager.adapter?.isReady && this.sessionManager.adapter.isReady()) {
              // Directly query provider_responses for this aiTurnId
              try {
                const allPR = await this.sessionManager.adapter.getAll('provider_responses');
                const pMaps = allPR
                  .filter(r => r && r.sessionId && r.aiTurnId === aiTurn.id && r.responseType === 'mapping' && r.text && String(r.text).trim().length > 0)
                  .sort((a,b) => (a.updatedAt||a.createdAt||0) - (b.updatedAt||b.createdAt||0));
                const last = pMaps[pMaps.length - 1];
                if (last) {
                  candidate = { text: last.text, meta: last.meta || {} };
                  candidatePid = last.providerId || 'unknown';
                  console.log('[WorkflowEngine] Fallback provider_responses lookup succeeded for historical mapping');
                }
              } catch (e2) {
                console.warn('[WorkflowEngine] provider_responses fallback failed:', e2);
              }
            }
            if (candidate) {
              mappingResult = { providerId: candidatePid, text: candidate.text, meta: candidate.meta };
              console.log(`[WorkflowEngine] Attached historical mapping result from ${candidatePid} (len=${candidate.text?.length})`);
            } else {
              console.log(`[WorkflowEngine] No historical mapping result found for userTurn ${userTurnId}`);
            }
          }
        } catch (e) {
          console.warn('[WorkflowEngine] Failed to fetch historical mapping for synthesis:', e);
        }
      }
    }

    const synthPrompt = buildSynthesisPrompt(
      payload.originalPrompt, 
      sourceData, 
      payload.synthesisProvider,
      mappingResult
    );

    // Resolve provider context using three-tier resolution
    const providerContexts = this._resolveProviderContext(
      payload.synthesisProvider, 
      context, 
      payload, 
      workflowContexts, 
      previousResults, 
      resolvedContext,
      'Synthesis'
    );

    return new Promise((resolve, reject) => {
      this.orchestrator.executeParallelFanout(synthPrompt, [payload.synthesisProvider], {
        sessionId: context.sessionId,
        useThinking: payload.useThinking,
        providerContexts: Object.keys(providerContexts).length ? providerContexts : undefined,
        providerMeta: step?.payload?.providerMeta,
        onPartial: (providerId, chunk) => {
  const delta = makeDelta(context.sessionId, providerId, chunk.text);
  
  if (delta && delta.length > 0) {
    this.port.postMessage({ 
      type: 'PARTIAL_RESULT', 
      sessionId: context.sessionId, 
      stepId: step.stepId, 
      providerId, 
      chunk: { text: delta } 
    });
    logger.stream('Synthesis delta:', { stepId: step.stepId, providerId, len: delta.length });
  }
},
        onAllComplete: (results) => {
          const finalResult = results.get(payload.synthesisProvider);
          
          // ✅ Ensure final emission for synthesis
          if (finalResult?.text) {
            const delta = makeDelta(context.sessionId, payload.synthesisProvider, finalResult.text);
            if (delta && delta.length > 0) {
              this.port.postMessage({  
                type: 'PARTIAL_RESULT',  
                sessionId: context.sessionId,  
                stepId: step.stepId,  
                providerId: payload.synthesisProvider,  
                chunk: { text: delta, isFinal: true }  
              }); 
              logger.stream('Final synthesis emission:', { providerId: payload.synthesisProvider, len: delta.length }); 
            } 
          }
          
          if (!finalResult || !finalResult.text) {
            reject(new Error(`Synthesis provider ${payload.synthesisProvider} returned empty response`));
            return;
          }

          this.sessionManager.updateProviderContext(
            context.sessionId, 
            payload.synthesisProvider, 
            finalResult, 
            true, 
            { skipSave: true }
          );
          this.sessionManager.saveSession(context.sessionId);
          // Update workflow-cached context for subsequent steps in the same workflow
          try {
            if (finalResult?.meta) {
              workflowContexts[payload.synthesisProvider] = finalResult.meta;
              console.log(`[WorkflowEngine] Updated workflow context for ${payload.synthesisProvider}: ${Object.keys(finalResult.meta).join(',')}`);
            }
          } catch (_) {}
          
          resolve({
            providerId: payload.synthesisProvider,
            text: finalResult.text, // ✅ Return text explicitly
            status: 'completed',
            meta: finalResult.meta || {}
          });
        }
      });
    });
  }

  /**
   * Execute mapping step - FIXED
   */
  async executeMappingStep(step, context, previousResults, workflowContexts = {}, resolvedContext) {
    const payload = step.payload;
    const sourceData = await this.resolveSourceData(payload, context, previousResults);
    
    if (sourceData.length === 0) {
      throw new Error("No valid sources for mapping. All providers returned empty or failed responses.");
    }

    console.log(`[WorkflowEngine] Running mapping with ${sourceData.length} sources:`, 
      sourceData.map(s => s.providerId).join(', '));

    const mappingPrompt = buildMappingPrompt(payload.originalPrompt, sourceData);

    // Resolve provider context using three-tier resolution
    const providerContexts = this._resolveProviderContext(
      payload.mappingProvider, 
      context, 
      payload, 
      workflowContexts, 
      previousResults, 
      resolvedContext,
      'Mapping'
    );

    return new Promise((resolve, reject) => {
      this.orchestrator.executeParallelFanout(mappingPrompt, [payload.mappingProvider], {
        sessionId: context.sessionId,
        useThinking: payload.useThinking,
        providerContexts: Object.keys(providerContexts).length ? providerContexts : undefined,
        providerMeta: step?.payload?.providerMeta,
        onPartial: (providerId, chunk) => {
  const delta = makeDelta(context.sessionId, providerId, chunk.text);
  
  if (delta && delta.length > 0) {
    this.port.postMessage({ 
      type: 'PARTIAL_RESULT', 
      sessionId: context.sessionId, 
      stepId: step.stepId, 
      providerId, 
      chunk: { text: delta } 
    });
    logger.stream('Mapping delta:', { stepId: step.stepId, providerId, len: delta.length });
  }
},
        onAllComplete: (results) => {
          const finalResult = results.get(payload.mappingProvider);
          
          // ✅ Ensure final emission for mapping
          if (finalResult?.text) {
            const delta = makeDelta(context.sessionId, payload.mappingProvider, finalResult.text);
            if (delta && delta.length > 0) {
              this.port.postMessage({  
                type: 'PARTIAL_RESULT',  
                sessionId: context.sessionId,  
                stepId: step.stepId,  
                providerId: payload.mappingProvider,  
                chunk: { text: delta, isFinal: true }  
              }); 
              logger.stream('Final mapping emission:', { providerId: payload.mappingProvider, len: delta.length }); 
            } 
          }
          
          if (!finalResult || !finalResult.text) {
            reject(new Error(`Mapping provider ${payload.mappingProvider} returned empty response`));
            return;
          }

          this.sessionManager.updateProviderContext(
            context.sessionId, 
            payload.mappingProvider, 
            finalResult, 
            true, 
            { skipSave: true }
          );
          this.sessionManager.saveSession(context.sessionId);
          // Update workflow-cached context for subsequent steps in the same workflow
          try {
            if (finalResult?.meta) {
              workflowContexts[payload.mappingProvider] = finalResult.meta;
              console.log(`[WorkflowEngine] Updated workflow context for ${payload.mappingProvider}: ${Object.keys(finalResult.meta).join(',')}`);
            }
          } catch (_) {}
          
          resolve({
            providerId: payload.mappingProvider,
            text: finalResult.text, // ✅ Return text explicitly
            status: 'completed',
            meta: finalResult.meta || {}
          });
        }
      });
    });
  }
}