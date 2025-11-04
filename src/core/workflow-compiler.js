// src/core/workflow-compiler.js - PHASE 3 COMPLETE
/**
 * WorkflowCompiler - PURE FUNCTION
 *
 * Phase 3 completion: Zero database access, fully synchronous.
 * All data comes from ResolvedContext parameter.
 */

export class WorkflowCompiler {
  constructor(sessionManager) {
    // Kept only for dependency injection - NEVER USED
    this.sessionManager = sessionManager;
  }

  /**
   * PURE COMPILE: Request + Context → Workflow Steps
   * 
   * @param {Object} request - ExecuteWorkflowRequest
   * @param {ResolvedContext} resolvedContext - REQUIRED from ContextResolver
   * @returns {Object} Executable workflow
   */
  compile(request, resolvedContext) {
    // Phase 3: Strict requirement enforcement
    if (!resolvedContext) {
      throw new Error('[Compiler] resolvedContext required. Call ContextResolver.resolve() first.');
    }

    this._validateRequest(request);
    this._validateContext(resolvedContext);

    const workflowId = this._generateWorkflowId(resolvedContext.type);
    const steps = [];

    console.log(`[Compiler] Compiling ${resolvedContext.type} workflow`);

    // ========================================================================
    // STEP GENERATION: Pure switch on context type
    // ========================================================================
    switch (resolvedContext.type) {
      case 'initialize':
      case 'extend':
        // Both need batch - context differs
        if (request.providers && request.providers.length > 0) {
          steps.push(this._createBatchStep(request, resolvedContext));
        }
        break;

      case 'recompute':
        // No batch - engine seeds frozen outputs
        console.log('[Compiler] Recompute: Skipping batch (frozen outputs)');
        break;
    }

    // Mapping
    if (this._needsMappingStep(request, resolvedContext)) {
      steps.push(this._createMappingStep(request, resolvedContext));
    }

    // Synthesis
    if (this._needsSynthesisStep(request, resolvedContext)) {
      steps.push(this._createSynthesisStep(request, resolvedContext));
    }

    const workflowContext = this._buildWorkflowContext(request, resolvedContext);

    console.log(`[Compiler] Generated ${steps.length} steps`);

    return {
      workflowId,
      context: workflowContext,
      steps
    };
  }

  // ============================================================================
  // STEP CREATORS (Pure)
  // ============================================================================

  _createBatchStep(request, context) {
    const isSynthesisFirst =
      request.synthesis?.enabled &&
      request.synthesis.providers?.length > 0 &&
      request.providers.length > 1;

    return {
      stepId: `batch-${Date.now()}`,
      type: 'prompt',
      payload: {
        prompt: request.userMessage,
        providers: request.providers,
        providerContexts: context.type === 'extend' 
          ? context.providerContexts 
          : undefined,
        providerMeta: request.providerMeta || {},
        hidden: !!isSynthesisFirst,
        useThinking: !!request.useThinking
      }
    };
  }

  _createMappingStep(request, context) {
    const mappingStepId = `mapping-${Date.now()}`;

    if (context.type === 'recompute') {
      return {
        stepId: mappingStepId,
        type: 'mapping',
        payload: {
          mappingProvider: context.targetProvider,
          sourceHistorical: {
            turnId: context.sourceTurnId,
            responseType: 'batch'
          },
          originalPrompt: context.sourceUserMessage,
          useThinking: !!request.useThinking,
          attemptNumber: 1
        }
      };
    }

    const mapper = request.mapper || this._getDefaultMapper(request);
    return {
      stepId: mappingStepId,
      type: 'mapping',
      payload: {
        mappingProvider: mapper,
        sourceStepIds: [`batch-${Date.now()}`],
        originalPrompt: request.userMessage,
        useThinking: !!request.useThinking && mapper === 'chatgpt',
        attemptNumber: 1
      }
    };
  }

  _createSynthesisStep(request, context) {
    const synthStepId = `synthesis-${Date.now()}`;
    const mappingStepId = `mapping-${Date.now()}`;

    if (context.type === 'recompute') {
      return {
        stepId: synthStepId,
        type: 'synthesis',
        payload: {
          synthesisProvider: context.targetProvider,
          sourceHistorical: {
            turnId: context.sourceTurnId,
            responseType: 'batch'
          },
          originalPrompt: context.sourceUserMessage,
          useThinking: !!request.useThinking,
          attemptNumber: 1,
          strategy: 'continuation',
          mappingStepIds: context.stepType === 'mapping' ? [mappingStepId] : undefined
        }
      };
    }

    const synthesizer = request.synthesizer || this._getDefaultSynthesizer(request);
    return {
      stepId: synthStepId,
      type: 'synthesis',
      payload: {
        synthesisProvider: synthesizer,
        sourceStepIds: [`batch-${Date.now()}`],
        mappingStepIds: request.includeMapping ? [mappingStepId] : undefined,
        originalPrompt: request.userMessage,
        useThinking: !!request.useThinking && synthesizer === 'chatgpt',
        attemptNumber: 1,
        strategy: 'continuation'
      }
    };
  }

  // ============================================================================
  // DECISION LOGIC (Pure)
  // ============================================================================

  _needsMappingStep(request, context) {
    if (context.type === 'recompute') {
      return context.stepType === 'mapping';
    }
    return request.includeMapping || false;
  }

  _needsSynthesisStep(request, context) {
    if (context.type === 'recompute') {
      return context.stepType === 'synthesis';
    }
    return request.includeSynthesis || false;
  }

  // ============================================================================
  // CONTEXT BUILDER (Pure)
  // ============================================================================

  _buildWorkflowContext(request, context) {
    let sessionId;
    let sessionCreated = false;

    switch (context.type) {
      case 'initialize':
        sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        sessionCreated = true;
        break;
      
      case 'extend':
      case 'recompute':
        sessionId = context.sessionId;
        break;
      
      default:
        sessionId = 'unknown-session';
    }

    const userMessage = context.type === 'recompute'
      ? context.sourceUserMessage
      : request.userMessage;

    return {
      sessionId,
      threadId: 'default-thread',
      targetUserTurnId: context.type === 'recompute' ? context.sourceTurnId : '',
      sessionCreated,
      userMessage
    };
  }

  // ============================================================================
  // UTILITIES (Pure)
  // ============================================================================

  _getDefaultMapper(request) {
    try {
      const stored = localStorage.getItem('htos_mapping_provider');
      if (stored) return stored;
    } catch {}
    return request.providers?.[0] || 'claude';
  }

  _getDefaultSynthesizer(request) {
    try {
      const stored = localStorage.getItem('htos_last_synthesis_model');
      if (stored) return stored;
    } catch {}
    return request.providers?.[0] || 'claude';
  }

  _generateWorkflowId(contextType) {
    return `wf-${contextType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // ============================================================================
  // VALIDATION
  // ============================================================================

  _validateRequest(request) {
    if (!request) throw new Error('[Compiler] Request required');
    
    const validModes = ['new-conversation', 'continuation'];
    if (!request.mode || !validModes.includes(request.mode)) {
      throw new Error(`[Compiler] Invalid mode: ${request.mode}`);
    }

    if (!request.historicalContext?.userTurnId && (!request.userMessage || !request.userMessage.trim())) {
      throw new Error('[Compiler] userMessage required');
    }

    const hasProviders = request.providers && request.providers.length > 0;
    const hasSynthesis = request.synthesis?.enabled && request.synthesis.providers?.length > 0;
    const hasMapping = request.mapping?.enabled && request.mapping.providers?.length > 0;

    if (!hasProviders && !hasSynthesis && !hasMapping) {
      throw new Error('[Compiler] Must specify at least one action');
    }
  }

  _validateContext(context) {
    if (!context?.type) throw new Error('[Compiler] Context type required');

    const validTypes = ['initialize', 'extend', 'recompute'];
    if (!validTypes.includes(context.type)) {
      throw new Error(`[Compiler] Invalid context type: ${context.type}`);
    }

    switch (context.type) {
      case 'extend':
        if (!context.sessionId) throw new Error('[Compiler] Extend: sessionId required');
        if (!context.lastTurnId) throw new Error('[Compiler] Extend: lastTurnId required');
        if (!context.providerContexts) throw new Error('[Compiler] Extend: providerContexts required');
        break;

      case 'recompute':
        if (!context.sessionId) throw new Error('[Compiler] Recompute: sessionId required');
        if (!context.sourceTurnId) throw new Error('[Compiler] Recompute: sourceTurnId required');
        if (!context.frozenBatchOutputs) throw new Error('[Compiler] Recompute: frozenBatchOutputs required');
        if (!context.stepType) throw new Error('[Compiler] Recompute: stepType required');
        break;
    }
  }
}