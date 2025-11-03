// src/core/context-resolver.js
/**
 * ContextResolver
 *
 * Resolves the minimal context needed for a workflow request.
 * Implements the 3 primitives: initialize, extend, recompute.
 *
 * Responsibilities:
 * - Non-blocking, targeted lookups (no full session hydration)
 * - Deterministic provider context resolution
 * - Immutable resolved context objects
 */

export class ContextResolver {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * Resolve context for any primitive request
   * @param {Object} request initialize | extend | recompute
   * @returns {Promise<Object>} ResolvedContext
   */
  async resolve(request) {
    if (!request || !request.type) {
      throw new Error('[ContextResolver] request.type is required');
    }

    switch (request.type) {
      case 'initialize':
        return this._resolveInitialize(request);
      case 'extend':
        return this._resolveExtend(request);
      case 'recompute':
        return this._resolveRecompute(request);
      default:
        throw new Error(`[ContextResolver] Unknown request type: ${request.type}`);
    }
  }

  // initialize: starting fresh
  async _resolveInitialize(request) {
    return {
      type: 'initialize',
      providers: request.providers || [],
    };
  }

  // extend: fetch last turn and extract provider contexts for requested providers
  async _resolveExtend(request) {
    const sessionId = request.sessionId;
    if (!sessionId) throw new Error('[ContextResolver] Extend requires sessionId');

    const session = await this._getSessionMetadata(sessionId);
    if (!session || !session.lastTurnId) {
      throw new Error(`[ContextResolver] Cannot extend: no lastTurnId for session ${sessionId}`);
    }

    const lastTurn = await this._getTurn(session.lastTurnId);
    if (!lastTurn) throw new Error(`[ContextResolver] Last turn ${session.lastTurnId} not found`);

    const relevantContexts = this._filterContexts(lastTurn.providerContexts || {}, request.providers || []);

    return {
      type: 'extend',
      sessionId,
      lastTurnId: lastTurn.id,
      providerContexts: relevantContexts,
    };
  }

  // recompute: fetch source AI turn, gather frozen batch outputs and original user message
  async _resolveRecompute(request) {
    const { sessionId, sourceTurnId, stepType, targetProvider } = request;
    if (!sessionId || !sourceTurnId) {
      throw new Error('[ContextResolver] Recompute requires sessionId and sourceTurnId');
    }

    const sourceTurn = await this._getTurn(sourceTurnId);
    if (!sourceTurn) throw new Error(`[ContextResolver] Source turn ${sourceTurnId} not found`);

    const frozenBatchOutputs = this._extractBatchOutputs(sourceTurn);
    if (!frozenBatchOutputs || Object.keys(frozenBatchOutputs).length === 0) {
      throw new Error(`[ContextResolver] Source turn ${sourceTurnId} has no batch outputs`);
    }

    const providerContextsAtSourceTurn = sourceTurn.providerContexts || {};
    const sourceUserMessage = await this._getUserMessageForTurn(sourceTurn);

    return {
      type: 'recompute',
      sessionId,
      sourceTurnId,
      frozenBatchOutputs,
      providerContextsAtSourceTurn,
      stepType,
      targetProvider,
      sourceUserMessage,
    };
  }

  // ===== helpers =====
  async _getSessionMetadata(sessionId) {
    try {
      if (this.sessionManager?.adapter?.isReady && this.sessionManager.adapter.isReady()) {
        return await this.sessionManager.adapter.get('sessions', sessionId);
      }
      return this.sessionManager?.sessions?.[sessionId] || null;
    } catch (e) {
      console.error('[ContextResolver] _getSessionMetadata failed:', e);
      return null;
    }
  }

  async _getTurn(turnId) {
    try {
      if (this.sessionManager?.adapter?.isReady && this.sessionManager.adapter.isReady()) {
        return await this.sessionManager.adapter.get('turns', turnId);
      }
      const sessions = this.sessionManager?.sessions || {};
      for (const session of Object.values(sessions)) {
        const turns = Array.isArray(session.turns) ? session.turns : [];
        const t = turns.find(x => x && x.id === turnId);
        if (t) return t;
      }
      return null;
    } catch (e) {
      console.error('[ContextResolver] _getTurn failed:', e);
      return null;
    }
  }

  _filterContexts(allContexts, requestedProviders) {
    const filtered = {};
    for (const pid of requestedProviders) {
      if (allContexts[pid]) {
        filtered[pid] = { meta: allContexts[pid], continueThread: true };
      }
    }
    return filtered;
  }

  _extractBatchOutputs(turn) {
    const responses = turn.batchResponses || turn.providerResponses || {};
    const frozen = {};
    for (const [providerId, r] of Object.entries(responses)) {
      if (r && r.text) {
        frozen[providerId] = {
          providerId,
          text: r.text,
          status: r.status || 'completed',
          meta: r.meta || {},
          createdAt: r.createdAt || turn.createdAt,
          updatedAt: r.updatedAt || turn.createdAt,
        };
      }
    }
    return frozen;
  }

  async _getUserMessageForTurn(aiTurn) {
    const userTurnId = aiTurn.userTurnId;
    if (!userTurnId) return '';
    const userTurn = await this._getTurn(userTurnId);
    return userTurn?.text || userTurn?.content || '';
  }
}
