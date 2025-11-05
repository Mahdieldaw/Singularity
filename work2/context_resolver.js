// src/core/context-resolver.js
/**
 * ContextResolver
 * 
 * NEW ABSTRACTION: Sits between ConnectionHandler and WorkflowCompiler.
 * 
 * RESPONSIBILITY: Resolve the minimal context needed for a workflow request.
 * This replaces the blocking _ensureSessionHydration with targeted, fast lookups.
 * 
 * KEY PRINCIPLES:
 * 1. Non-blocking: Only fetches what's needed (last turn, not full session)
 * 2. Primitive-aware: Different resolution logic for Initialize/Extend/Recompute
 * 3. Fast: Indexed queries, no full hydration
 * 4. Pure output: Returns immutable ResolvedContext objects
 */

export class ContextResolver {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * Main entry point: Resolve context for any WorkflowRequest
   * 
   * @param {InitializeRequest | ExtendRequest | RecomputeRequest} request
   * @returns {Promise<ResolvedContext>}
   */
  async resolve(request) {
    console.log(`[ContextResolver] Resolving context for ${request.type} request`);
    
    switch (request.type) {
      case 'initialize':
        return this._resolveInitialize(request);
      
      case 'extend':
        return this._resolveExtend(request);
      
      case 'recompute':
        return this._resolveRecompute(request);
      
      default:
        throw new Error(`Unknown request type: ${request.type}`);
    }
  }

  /**
   * INITIALIZE: Starting fresh - no data to fetch
   * 
   * @param {InitializeRequest} request
   * @returns {Promise<InitializeContext>}
   */
  async _resolveInitialize(request) {
    console.log('[ContextResolver] Initialize: No context to fetch (starting fresh)');
    
    return {
      type: 'initialize',
      providers: request.providers
    };
  }

  /**
   * EXTEND: Fetch last turn to get its provider contexts
   * 
   * PERFORMANCE NOTE: This is a single, indexed DB query (by lastTurnId).
   * Much faster than hydrating the entire session.
   * 
   * @param {ExtendRequest} request
   * @returns {Promise<ExtendContext>}
   */
  async _resolveExtend(request) {
    const sessionId = request.sessionId;
    
    if (!sessionId) {
      throw new Error('[ContextResolver] Extend request missing sessionId');
    }

    // Fetch session metadata (lightweight - just lastTurnId)
    const session = await this._getSessionMetadata(sessionId);
    
    if (!session || !session.lastTurnId) {
      throw new Error(`[ContextResolver] Cannot extend session ${sessionId}: No turns found. Use 'initialize' instead.`);
    }

    // Fetch ONLY the last turn (single indexed query)
    const lastTurn = await this._getTurn(session.lastTurnId);
    
    if (!lastTurn) {
      throw new Error(`[ContextResolver] Last turn ${session.lastTurnId} not found in session ${sessionId}`);
    }

    // Extract provider contexts from last turn
    // Filter to only requested providers
    const relevantContexts = this._filterContexts(
      lastTurn.providerContexts || {},
      request.providers
    );

    console.log(`[ContextResolver] Extend: Loaded contexts for ${Object.keys(relevantContexts).length} providers from turn ${lastTurn.id}`);

    return {
      type: 'extend',
      sessionId,
      lastTurnId: lastTurn.id,
      providerContexts: relevantContexts
    };
  }

  /**
   * RECOMPUTE: Fetch source turn to get frozen outputs and historical contexts
   * 
   * @param {RecomputeRequest} request
   * @returns {Promise<RecomputeContext>}
   */
  async _resolveRecompute(request) {
    const { sessionId, sourceTurnId, stepType, targetProvider } = request;

    if (!sessionId || !sourceTurnId) {
      throw new Error('[ContextResolver] Recompute request missing sessionId or sourceTurnId');
    }

    // Fetch source turn (single indexed query)
    const sourceTurn = await this._getTurn(sourceTurnId);
    
    if (!sourceTurn) {
      throw new Error(`[ContextResolver] Source turn ${sourceTurnId} not found`);
    }

    // Extract frozen batch outputs
    const frozenBatchOutputs = this._extractBatchOutputs(sourceTurn);
    
    if (!frozenBatchOutputs || Object.keys(frozenBatchOutputs).length === 0) {
      throw new Error(`[ContextResolver] Source turn ${sourceTurnId} has no batch outputs to recompute from`);
    }

    // Get provider contexts as they were at source turn
    const providerContextsAtSourceTurn = sourceTurn.providerContexts || {};

    // Get original user message from source turn's paired user turn
    const sourceUserMessage = await this._getUserMessageForTurn(sourceTurn);

    console.log(`[ContextResolver] Recompute: Loaded ${Object.keys(frozenBatchOutputs).length} frozen outputs and contexts from turn ${sourceTurnId}`);

    return {
      type: 'recompute',
      sessionId,
      sourceTurnId,
      frozenBatchOutputs,
      providerContextsAtSourceTurn,
      stepType,
      targetProvider,
      sourceUserMessage
    };
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Fetch session metadata (lightweight - no full hydration)
   */
  async _getSessionMetadata(sessionId) {
    try {
      // Use adapter directly for fast lookup
      if (this.sessionManager.adapter?.isReady()) {
        return await this.sessionManager.adapter.get('sessions', sessionId);
      }
      
      // Fallback: check in-memory cache
      return this.sessionManager.sessions?.[sessionId] || null;
    } catch (error) {
      console.error(`[ContextResolver] Failed to fetch session ${sessionId}:`, error);
      return null;
    }
  }

  /**
   * Fetch a single turn by ID (indexed query)
   */
  async _getTurn(turnId) {
    try {
      // Use adapter directly for fast lookup
      if (this.sessionManager.adapter?.isReady()) {
        return await this.sessionManager.adapter.get('turns', turnId);
      }
      
      // Fallback: scan in-memory cache
      const sessions = this.sessionManager.sessions || {};
      for (const session of Object.values(sessions)) {
        const turns = Array.isArray(session.turns) ? session.turns : [];
        const turn = turns.find(t => t.id === turnId);
        if (turn) return turn;
      }
      
      return null;
    } catch (error) {
      console.error(`[ContextResolver] Failed to fetch turn ${turnId}:`, error);
      return null;
    }
  }

  /**
   * Filter provider contexts to only requested providers
   */
  _filterContexts(allContexts, requestedProviders) {
    const filtered = {};
    
    for (const providerId of requestedProviders) {
      if (allContexts[providerId]) {
        filtered[providerId] = {
          meta: allContexts[providerId],
          continueThread: true
        };
      }
      // If context missing, provider will start new conversation
    }
    
    return filtered;
  }

  /**
   * Extract batch outputs from a turn
   */
  _extractBatchOutputs(turn) {
    // Turn may have batchResponses or providerResponses (legacy compat)
    const responses = turn.batchResponses || turn.providerResponses || {};
    
    // Convert to frozen format
    const frozen = {};
    for (const [providerId, response] of Object.entries(responses)) {
      if (response && response.text) {
        frozen[providerId] = {
          providerId,
          text: response.text,
          status: response.status || 'completed',
          meta: response.meta || {},
          createdAt: response.createdAt || turn.createdAt,
          updatedAt: response.updatedAt || turn.createdAt
        };
      }
    }
    
    return frozen;
  }

  /**
   * Get the original user message for a given AI turn
   */
  async _getUserMessageForTurn(aiTurn) {
    const userTurnId = aiTurn.userTurnId;
    
    if (!userTurnId) {
      console.warn('[ContextResolver] AI turn has no userTurnId, using empty message');
      return '';
    }

    const userTurn = await this._getTurn(userTurnId);
    
    if (!userTurn) {
      console.warn(`[ContextResolver] User turn ${userTurnId} not found, using empty message`);
      return '';
    }

    return userTurn.text || userTurn.content || '';
  }
}
