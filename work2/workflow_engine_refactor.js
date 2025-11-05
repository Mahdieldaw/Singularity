// src/core/workflow-engine.js - REFACTORED (Part 1: Core Logic)
/**
 * WorkflowEngine - REFACTORED
 * 
 * KEY CHANGES:
 * 1. NEW: Accepts ResolvedContext as parameter
 * 2. NEW: Seeds frozen outputs for recompute primitive
 * 3. UPDATED: Step execution uses context data
 * 4. SIMPLIFIED: Context routing logic
 */

// Helper functions (unchanged from original)
function buildSynthesisPrompt(originalPrompt, sourceResults, synthesisProvider, mappingResult = null) {
  const filteredResults = sourceResults.filter(res => {
    const isSynthesizer = res.providerId === synthesisProvider;
    return !isSynthesizer;
  });

  const otherItems = filteredResults
    .map(res => `**${(res.providerId || 'UNKNOWN').toUpperCase()}:**\n${String(res.text)}`);

  const otherResults = otherItems.join('\n\n');
  const mappingSection = mappingResult ? `\n\n**CONFLICT RESOLUTION MAP:**\n${mappingResult.text}\n\n` : '';

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

**Map the landscape** – Group similar ideas, preserving tensions and contradictions.
**Surface the invisible** – Highlight consensus from 2+ models, unique sightings from one model as natural flow.
**Frame the choices** – present alternatives as "If you prioritize X, this path fits because Y."
**Flag the unknowns** – Note disagreements or uncertainties as subtle cautions.
**Anticipate the journey** – End with a subtle suggestion: "This naturally leads to questions about..." or "The next consideration might be..." based on the tensions and gaps identified.
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

// Delta streaming state
const lastStreamState = new Map();

function makeDelta(sessionId, providerId, fullText = "") {
  if (!sessionId) return fullText || "";
  
  const key = `${sessionId}:${providerId}`;
  const prev = lastStreamState.get(key) || "";
  let delta = "";

  if (prev.length === 0 && fullText && fullText.length > 0) {
    delta = fullText;
    lastStreamState.set(key, fullText);
    return delta;
  }

  if (fullText && fullText.length > prev.length) {
    let prefixLen = 0;
    const minLen = Math.min(prev.length, fullText.length);
    
    while (prefixLen < minLen && prev[prefixLen] === fullText[prefixLen]) {
      prefixLen++;
    }
    
    if (prefixLen >= prev.length * 0.7) {
      delta = fullText.slice(prev.length);
      lastStreamState.set(key, fullText);
    } else {
      lastStreamState.set(key, fullText);
      return fullText.slice(prefixLen);
    }
    return delta;
  }

  if (fullText === prev) {
    return "";
  }

  if (fullText.length < prev.length) {
    const regression = prev.length - fullText.length;
    const regressionPercent = (regression / prev.length) * 100;
    const isSmallRegression = regression <= 200 || regressionPercent <= 5;
    
    if (isSmallRegression) {
      lastStreamState.set(key, fullText);
      return "";
    }
    
    console.warn(`[makeDelta] Significant text regression for ${providerId}:`, { 
      prevLen: prev.length, 
      fullLen: fullText.length,
      regression,
      regressionPercent: regressionPercent.toFixed(1) + '%'
    });
    return "";
  }

  return "";
}

function clearDeltaCache(sessionId) {
  if (!sessionId) return;
  
  const keysToDelete = [];
  lastStreamState.forEach((_, key) => {
    if (key.startsWith(`${sessionId}:`)) {
      keysToDelete.push(key);
    }
  });
  
  keysToDelete.forEach(key => lastStreamState.delete(key));
}

// Smart console filter
const STREAMING_DEBUG = false;

const logger = {
  stream: (...args) => {
    if (STREAMING_DEBUG) console.debug('[STREAM]', ...args);
  },
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console)
};

// ============================================================================
// WORKFLOW ENGINE - REFACTORED
// ============================================================================

export class WorkflowEngine {
  constructor(orchestrator, sessionManager, port) {
    this.orchestrator = orchestrator;
    this.sessionManager = sessionManager;
    this.port = port;
    this._lastFinalizedTurn = null;
  }

  /**
   * REFACTORED: Execute workflow with ResolvedContext
   * 
   * @param {WorkflowRequest} request - Compiled workflow
   * @param {ResolvedContext} context - Resolved context data
   */
  async execute(request, context) {
    const { context: workflowContext, steps } = request;
    const stepResults = new Map();
    const workflowContexts = {}; // In-memory per-workflow cache

    // Cache current user message for persistence
    this.currentUserMessage = workflowContext?.userMessage || this.currentUserMessage || '';

    // Ensure session exists
    if (!workflowContext.sessionId || workflowContext.sessionId === 'new-session') {
      workflowContext.sessionId = workflowContext.sessionId && workflowContext.sessionId !== 'new-session'
        ? workflowContext.sessionId
        : `sid-${Date.now()}`;
    }

    try {
      // ========================================================================
      // NEW: Seed frozen outputs for recompute
      // ========================================================================
      if (context.type === 'recompute') {
        console.log('[WorkflowEngine] Seeding frozen batch outputs for recompute');
        stepResults.set('batch', { 
          status: 'completed', 
          result: { results: context.frozenBatchOutputs } 
        });
        
        // Also cache the contexts from source turn
        Object.entries(context.providerContextsAtSourceTurn || {}).forEach(([pid, ctx]) => {
          workflowContexts[pid] = ctx;
        });
      }

      // ========================================================================
      // Execute steps by type (batch, then mapping, then synthesis)
      // ========================================================================
      const promptSteps = steps.filter(step => step.type === 'prompt');
      const mappingSteps = steps.filter(step => step.type === 'mapping');
      const synthesisSteps = steps.filter(step => step.type === 'synthesis');

      // 1. Execute batch prompt steps
      for (const step of promptSteps) {
        try {
          const result = await this.executePromptStep(step, workflowContext);
          stepResults.set(step.stepId, { status: 'completed', result });
          this.port.postMessage({ 
            type: 'WORKFLOW_STEP_UPDATE', 
            sessionId: workflowContext.sessionId, 
            stepId: step.stepId, 
            status: 'completed', 
            result 
          });

          // Cache provider contexts from batch step
          try {
            const resultsObj = result && result.results ? result.results : {};
            Object.entries(resultsObj).forEach(([pid, data]) => {
              if (data && data.meta && Object.keys(data.meta).length > 0) {
                workflowContexts[pid] = data.meta;
              }
            });
          } catch (e) { /* best-effort */ }
        } catch (error) {
          console.error(`[WorkflowEngine] Prompt step ${step.stepId} failed:`, error);
          stepResults.set(step.stepId, { status: 'failed', error: error.message });
          this.port.postMessage({ 
            type: 'WORKFLOW_STEP_UPDATE', 
            sessionId: workflowContext.sessionId, 
            stepId: step.stepId, 
            status: 'failed', 
            error: error.message 
          });
          this.port.postMessage({ 
            type: 'WORKFLOW_COMPLETE', 
            sessionId: workflowContext.sessionId, 
            workflowId: request.workflowId, 
            finalResults: Object.fromEntries(stepResults) 
          });
          return;
        }
      }

      // 2. Execute mapping steps
      for (const step of mappingSteps) {
        try {
          const result = await this.executeMappingStep(step, workflowContext, stepResults, workflowContexts, context);
          stepResults.set(step.stepId, { status: 'completed', result });
          this.port.postMessage({ 
            type: 'WORKFLOW_STEP_UPDATE', 
            sessionId: workflowContext.sessionId, 
            stepId: step.stepId, 
            status: 'completed', 
            result 
          });
        } catch (error) {
          console.error(`[WorkflowEngine] Mapping step ${step.stepId} failed:`, error);
          stepResults.set(step.stepId, { status: 'failed', error: error.message });
          this.port.postMessage({ 
            type: 'WORKFLOW_STEP_UPDATE', 
            sessionId: workflowContext.sessionId, 
            stepId: step.stepId, 
            status: 'failed', 
            error: error.message 
          });
        }
      }

      // 3. Execute synthesis steps
      for (const step of synthesisSteps) {
        try {
          const result = await this.executeSynthesisStep(step, workflowContext, stepResults, workflowContexts, context);
          stepResults.set(step.stepId, { status: 'completed', result });
          this.port.postMessage({ 
            type: 'WORKFLOW_STEP_UPDATE', 
            sessionId: workflowContext.sessionId, 
            stepId: step.stepId, 
            status: 'completed', 
            result 
          });
        } catch (error) {
          console.error(`[WorkflowEngine] Synthesis step ${step.stepId} failed:`, error);
          stepResults.set(step.stepId, { status: 'failed', error: error.message });
          this.port.postMessage({ 
            type: 'WORKFLOW_STEP_UPDATE', 
            sessionId: workflowContext.sessionId, 
            stepId: step.stepId, 
            status: 'failed', 
            error: error.message 
          });
        }
      }

      // ========================================================================
      // Persistence & Completion
      // ========================================================================
      try {
        await this._persistCriticalTurnData(workflowContext, steps, stepResults, context);
      } catch (e) {
        console.error('[WorkflowEngine] CRITICAL persistence failed:', e);
      }

      this.port.postMessage({ 
        type: 'WORKFLOW_COMPLETE', 
        sessionId: workflowContext.sessionId, 
        workflowId: request.workflowId, 
        finalResults: Object.fromEntries(stepResults) 
      });

      this._emitTurnFinalized(workflowContext, steps, stepResults);
      clearDeltaCache(workflowContext.sessionId);

      setTimeout(() => {
        this._persistNonCriticalData(workflowContext, steps, stepResults, context).catch(e => {
          console.warn('[WorkflowEngine] Deferred non-critical persistence failed:', e);
        });
      }, 0);

    } catch (error) {
      console.error(`[WorkflowEngine] Critical workflow execution error:`, error);
      this.port.postMessage({ 
        type: 'WORKFLOW_COMPLETE', 
        sessionId: workflowContext.sessionId, 
        workflowId: request.workflowId, 
        error: 'A critical error occurred.' 
      });
    }
  }

  // ... (Continue in Part 2)
