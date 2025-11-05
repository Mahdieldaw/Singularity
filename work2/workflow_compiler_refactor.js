// src/core/workflow-compiler.js - REFACTORED
/**
 * WorkflowCompiler - PURE FUNCTION VERSION
 *
 * Translates a high-level WorkflowRequest + ResolvedContext into a sequence of
 * low-level WorkflowSteps the engine can execute.
 *
 * KEY CHANGES IN THIS REFACTOR:
 * 1. REMOVED: All async/await (now a pure, synchronous function)
 * 2. REMOVED: All database/SessionManager calls (data comes from ResolvedContext)
 * 3. SIMPLIFIED: Complex branching replaced with simple switch on context.type
 * 4. NEW: Handles recompute primitive (skip batch, use frozen outputs)
 */

export class WorkflowCompiler {
  constructor(sessionManager) {
    // Keep reference for backward compatibility, but don't use it
    this.sessionManager = sessionManager;
  }

  /**
   * REFACTORED: Compile request + context into executable workflow
   * 
   * NOW PURE: No async, no DB access, all data from arguments
   * 
   * @param {InitializeRequest | ExtendRequest | RecomputeRequest} request
   * @param {ResolvedContext} context - All data needed for compilation
   * @returns {WorkflowRequest} - Executable workflow
   */
  compile(request, context) {
    this._validateRequest(request);
    this._validateContext(context);

    const workflowId = this._generateWorkflowId(request.type);
    const steps = [];

    console.log(`[Compiler] Compiling ${request.type} request with ${context.type} context`);

    // ========================================================================
    // STEP GENERATION: Simple switch on context type
    // ========================================================================
    switch (context.type) {
      case 'initialize':
      case 'extend':
        // Both need batch step - context just differs
        steps.push(this._createBatchStep(request, context));
        break;

      case 'recompute':
        // Skip batch - frozen outputs will be seeded by engine
        console.log('[Compiler] Recompute: Skipping batch step (using frozen outputs)');
        break;

      default:
        throw new Error(`Unknown context type: ${context.type}`);
    }

    // Mapping step (if requested)
    if (this._needsMappingStep(request, context)) {
      steps.push(this._createMappingStep(request, context));
    }

    // Synthesis step (if requested)
    if (this._needsSynthesisStep(request, context)) {
      steps.push(this._createSynthesisStep(request, context));
    }

    // Build workflow context
    const workflowContext = this._buildWorkflowContext(request, context);

    console.log(`[Compiler] Generated ${steps.length} steps for workflow ${workflowId}`);

    return {
      workflowId,
      context: workflowContext,
      steps
    };
  }

  // ============================================================================
  // STEP CREATION METHODS
  // ============================================================================

  /**
   * Create batch prompt step
   * 
   * For initialize: empty contexts (fresh start)
   * For extend: contexts from last turn
   */
  _createBatchStep(request, context) {
    const isSynthesisFirst =
      request.synthesis?.enabled &&
      Array.isArray(request.synthesis.providers) &&
      request.synthesis.providers.length > 0 &&
      request.providers.length > 1;

    return {
      stepId: `batch-${Date.now()}`,
      type: 'prompt',
      payload: {
        prompt: request.userMessage,
        providers: request.providers,
        // For initialize: no contexts (all fresh)
        // For extend: contexts from last turn
        providerContexts: context.type === 'extend' ? context.providerContexts : undefined,
        providerMeta: request.providerMeta || {},
        hidden: !!isSynthesisFirst,
        useThinking: !!request.useThinking
      }
    };
  }

  /**
   * Create mapping step
   */
  _createMappingStep(request, context) {
    const mappingStepId = `mapping-${Date.now()}`;
    const mapper = request.mapper || this._getDefaultMapper(request);

    if (context.type === 'recompute') {
      // Recompute: Use frozen outputs from source turn
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
    } else {
      // Initialize/Extend: Use live batch outputs
      return {
        stepId: mappingStepId,
        type: 'mapping',
        payload: {
          mappingProvider: mapper,
          sourceStepIds: [`batch-${Date.now()}`],  // Will be matched by engine
          originalPrompt: request.userMessage,
          useThinking: !!request.useThinking && mapper === 'chatgpt',
          attemptNumber: 1
        }
      };
    }
  }

  /**
   * Create synthesis step
   */
  _createSynthesisStep(request, context) {
    const synthStepId = `synthesis-${Date.now()}`;
    const synthesizer = request.synthesizer || this._getDefaultSynthesizer(request);

    if (context.type === 'recompute') {
      // Recompute: Use frozen outputs from source turn
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
          strategy: 'continuation'
        }
      };
    } else {
      // Initialize/Extend: Use live batch outputs
      return {
        stepId: synthStepId,
        type: 'synthesis',
        payload: {
          synthesisProvider: synthesizer,
          sourceStepIds: [`batch-${Date.now()}`],  // Will be matched by engine
          originalPrompt: request.userMessage,
          useThinking: !!request.useThinking && synthesizer === 'chatgpt',
          attemptNumber: 1,
          strategy: 'continuation'
        }
      };
    }
  }

  // ============================================================================
  // DECISION METHODS
  // ============================================================================

  /**
   * Determine if mapping step is needed
   */
  _needsMappingStep(request, context) {
    if (context.type === 'recompute') {
      return context.stepType === 'mapping';
    }
    return request.includeMapping || false;
  }

  /**
   * Determine if synthesis step is needed
   */
  _needsSynthesisStep(request, context) {
    if (context.type === 'recompute') {
      return context.stepType === 'synthesis';
    }
    return request.includeSynthesis || false;
  }

  // ============================================================================
  // WORKFLOW CONTEXT BUILDER
  // ============================================================================

  /**
   * Build workflow context for engine
   */
  _buildWorkflowContext(request, context) {
    let sessionId;
    let sessionCreated = false;

    // Determine sessionId
    if (context.type === 'initialize') {
      // Generate new session ID
      sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      sessionCreated = true;
    } else {
      // Use existing session from context
      sessionId = context.sessionId;
    }

    // Determine user message
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
  // HELPER METHODS
  // ============================================================================

  _getDefaultMapper(request) {
    // Try to get from localStorage
    try {
      const stored = localStorage.getItem('htos_mapping_provider');
      if (stored) return stored;
    } catch {}

    // Fallback: first provider
    return request.providers?.[0] || 'claude';
  }

  _getDefaultSynthesizer(request) {
    // Try to get from localStorage
    try {
      const stored = localStorage.getItem('htos_last_synthesis_model');
      if (stored) return stored;
    } catch {}

    // Fallback: first provider
    return request.providers?.[0] || 'claude';
  }

  _generateWorkflowId(requestType) {
    return `wf-${requestType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // ============================================================================
  // VALIDATION METHODS
  // ============================================================================

  _validateRequest(request) {
    if (!request) {
      throw new Error('Request is required');
    }

    if (!request.type) {
      throw new Error('Request type is required');
    }

    const validTypes = ['initialize', 'extend', 'recompute'];
    if (!validTypes.includes(request.type)) {
      throw new Error(`Invalid request type: ${request.type}`);
    }

    // Type-specific validation
    switch (request.type) {
      case 'initialize':
        if (!request.userMessage?.trim()) {
          throw new Error('Initialize requires userMessage');
        }
        if (!Array.isArray(request.providers) || request.providers.length === 0) {
          throw new Error('Initialize requires at least one provider');
        }
        break;

      case 'extend':
        if (!request.sessionId) {
          throw new Error('Extend requires sessionId');
        }
        if (!request.userMessage?.trim()) {
          throw new Error('Extend requires userMessage');
        }
        if (!Array.isArray(request.providers) || request.providers.length === 0) {
          throw new Error('Extend requires at least one provider');
        }
        break;

      case 'recompute':
        if (!request.sessionId) {
          throw new Error('Recompute requires sessionId');
        }
        if (!request.sourceTurnId) {
          throw new Error('Recompute requires sourceTurnId');
        }
        if (!request.stepType || !['synthesis', 'mapping'].includes(request.stepType)) {
          throw new Error('Recompute requires valid stepType (synthesis or mapping)');
        }
        if (!request.targetProvider) {
          throw new Error('Recompute requires targetProvider');
        }
        break;
    }
  }

  _validateContext(context) {
    if (!context) {
      throw new Error('Context is required');
    }

    if (!context.type) {
      throw new Error('Context type is required');
    }

    const validTypes = ['initialize', 'extend', 'recompute'];
    if (!validTypes.includes(context.type)) {
      throw new Error(`Invalid context type: ${context.type}`);
    }

    // Type-specific validation
    switch (context.type) {
      case 'initialize':
        if (!Array.isArray(context.providers)) {
          throw new Error('Initialize context requires providers array');
        }
        break;

      case 'extend':
        if (!context.sessionId) {
          throw new Error('Extend context requires sessionId');
        }
        if (!context.lastTurnId) {
          throw new Error('Extend context requires lastTurnId');
        }
        if (!context.providerContexts) {
          throw new Error('Extend context requires providerContexts');
        }
        break;

      case 'recompute':
        if (!context.sessionId) {
          throw new Error('Recompute context requires sessionId');
        }
        if (!context.sourceTurnId) {
          throw new Error('Recompute context requires sourceTurnId');
        }
        if (!context.frozenBatchOutputs) {
          throw new Error('Recompute context requires frozenBatchOutputs');
        }
        if (!context.stepType || !['synthesis', 'mapping'].includes(context.stepType)) {
          throw new Error('Recompute context requires valid stepType');
        }
        break;
    }
  }
}
