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
      throw new Error("[ContextResolver] request.type is required");
    }

    switch (request.type) {
      case "initialize":
        return this._resolveInitialize(request);
      case "extend":
        return this._resolveExtend(request);
      case "recompute":
        return this._resolveRecompute(request);
      default:
        throw new Error(
          `[ContextResolver] Unknown request type: ${request.type}`,
        );
    }
  }

  // initialize: starting fresh
  async _resolveInitialize(request) {
    return {
      type: "initialize",
      providers: request.providers || [],
    };
  }

  // extend: fetch last turn and extract provider contexts for requested providers
  async _resolveExtend(request) {
    const sessionId = request.sessionId;
    if (!sessionId)
      throw new Error("[ContextResolver] Extend requires sessionId");

    const session = await this._getSessionMetadata(sessionId);
    if (!session || !session.lastTurnId) {
      throw new Error(
        `[ContextResolver] Cannot extend: no lastTurnId for session ${sessionId}`,
      );
    }

    const lastTurn = await this._getTurn(session.lastTurnId);
    if (!lastTurn)
      throw new Error(
        `[ContextResolver] Last turn ${session.lastTurnId} not found`,
      );

    // Prefer turn-scoped provider contexts
    // Normalization: stored shape may be either { [pid]: meta } or { [pid]: { meta } }
    const turnContexts = lastTurn.providerContexts || {};
    const normalized = {};
    for (const [pid, ctx] of Object.entries(turnContexts)) {
      normalized[pid] = ctx && ctx.meta ? ctx.meta : ctx;
    }

    const relevantContexts = this._filterContexts(
      normalized,
      request.providers || [],
    );

    return {
      type: "extend",
      sessionId,
      lastTurnId: lastTurn.id,
      providerContexts: relevantContexts,
    };
  }

  // recompute: fetch source AI turn, gather frozen batch outputs and original user message
  async _resolveRecompute(request) {
    const { sessionId, sourceTurnId, stepType, targetProvider } = request;
    if (!sessionId || !sourceTurnId) {
      throw new Error(
        "[ContextResolver] Recompute requires sessionId and sourceTurnId",
      );
    }

    const sourceTurn = await this._getTurn(sourceTurnId);
    if (!sourceTurn)
      throw new Error(
        `[ContextResolver] Source turn ${sourceTurnId} not found`,
      );

    // Build frozen outputs from provider_responses store, not embedded turn fields
    const responses = await this._getProviderResponsesForTurn(sourceTurnId);
    const frozenBatchOutputs = this._aggregateBatchOutputs(responses);
    if (!frozenBatchOutputs || Object.keys(frozenBatchOutputs).length === 0) {
      throw new Error(
        `[ContextResolver] Source turn ${sourceTurnId} has no batch outputs in provider_responses`,
      );
    }

    // Determine the latest valid mapping output for this source turn
    const latestMappingOutput = this._findLatestMappingOutput(
      responses,
      request.preferredMappingProvider,
    );
    // Also resolve latest synthesis output for mapping recompute
    const latestSynthesisOutput = this._findLatestSynthesisOutput(responses);

    const providerContextsAtSourceTurn = sourceTurn.providerContexts || {};
    const sourceUserMessage = await this._getUserMessageForTurn(sourceTurn);

    return {
      type: "recompute",
      sessionId,
      sourceTurnId,
      frozenBatchOutputs,
      latestMappingOutput,
      latestSynthesisOutput, // ← NEW: Include historical synthesis for mapping
      providerContextsAtSourceTurn,
      stepType,
      targetProvider,
      sourceUserMessage,
    };
  }

  // ===== helpers =====
  async _getSessionMetadata(sessionId) {
    try {
      if (
        this.sessionManager?.adapter?.isReady &&
        this.sessionManager.adapter.isReady()
      ) {
        return await this.sessionManager.adapter.get("sessions", sessionId);
      }
      return this.sessionManager?.sessions?.[sessionId] || null;
    } catch (e) {
      console.error("[ContextResolver] _getSessionMetadata failed:", e);
      return null;
    }
  }

  async _getTurn(turnId) {
    try {
      if (
        this.sessionManager?.adapter?.isReady &&
        this.sessionManager.adapter.isReady()
      ) {
        return await this.sessionManager.adapter.get("turns", turnId);
      }
      const sessions = this.sessionManager?.sessions || {};
      for (const session of Object.values(sessions)) {
        const turns = Array.isArray(session.turns) ? session.turns : [];
        const t = turns.find((x) => x && x.id === turnId);
        if (t) return t;
      }
      return null;
    } catch (e) {
      console.error("[ContextResolver] _getTurn failed:", e);
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
    // Legacy fallback: if embedded responses exist on the turn, use them
    const embedded = turn.batchResponses || turn.providerResponses || {};
    if (embedded && Object.keys(embedded).length > 0) {
      const frozen = {};
      for (const [providerId, r] of Object.entries(embedded)) {
        if (r && r.text) {
          frozen[providerId] = {
            providerId,
            text: r.text,
            status: r.status || "completed",
            meta: r.meta || {},
            createdAt: r.createdAt || turn.createdAt,
            updatedAt: r.updatedAt || turn.createdAt,
          };
        }
      }
      return frozen;
    }
    return {};
  }

  async _getUserMessageForTurn(aiTurn) {
    const userTurnId = aiTurn.userTurnId;
    if (!userTurnId) return "";
    const userTurn = await this._getTurn(userTurnId);
    return userTurn?.text || userTurn?.content || "";
  }

  /**
   * Fetch provider responses for a given AI turn using adapter indices if available.
   * Simplified: always use the indexed adapter.getResponsesByTurnId for high performance.
   */
  async _getProviderResponsesForTurn(aiTurnId) {
    // No more fallbacks or readiness checks. Trust the adapter.
    // If this fails, it should throw an error, which is the desired "fail fast" behavior.
    return this.sessionManager.adapter.getResponsesByTurnId(aiTurnId);
  }

  /**
   * Aggregate batch outputs per provider from raw provider response records.
   * Chooses the latest completed 'batch' response for each provider.
   */
  _aggregateBatchOutputs(providerResponses = []) {
    try {
      const frozen = {};
      const byProvider = new Map();
      for (const r of providerResponses) {
        if (!r || r.responseType !== "batch") continue;
        const pid = r.providerId;
        const existing = byProvider.get(pid);
        // Prefer the latest completed response
        const rank = (val) =>
          val?.status === "completed" ? 2 : val?.status === "streaming" ? 1 : 0;
        if (
          !existing ||
          (r.updatedAt ?? 0) > (existing.updatedAt ?? 0) ||
          rank(r) > rank(existing)
        ) {
          byProvider.set(pid, r);
        }
      }
      for (const [pid, r] of byProvider.entries()) {
        frozen[pid] = {
          providerId: pid,
          text: r.text || "",
          status: r.status || "completed",
          meta: r.meta || {},
          createdAt: r.createdAt || Date.now(),
          updatedAt: r.updatedAt || r.createdAt || Date.now(),
        };
      }
      return frozen;
    } catch (e) {
      console.warn("[ContextResolver] _aggregateBatchOutputs failed:", e);
      return {};
    }
  }

  /**
   * Find the latest valid mapping output among provider responses for a turn.
   * If a preferred provider is specified, use it when present; otherwise return the most recent.
   */
  _findLatestMappingOutput(providerResponses = [], preferredProvider) {
    try {
      if (!providerResponses || providerResponses.length === 0) {
        return null;
      }

      const mappingResponses = providerResponses.filter(
        (r) =>
          r &&
          r.responseType === "mapping" &&
          r.text &&
          String(r.text).trim().length > 0,
      );

      if (mappingResponses.length === 0) {
        return null;
      }

      // Sort by most recent update
      mappingResponses.sort(
        (a, b) =>
          (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0),
      );

      if (preferredProvider) {
        const preferred = mappingResponses.find(
          (r) => r.providerId === preferredProvider,
        );
        if (preferred) {
          console.log(
            `[ContextResolver] Found preferred mapping output from ${preferredProvider}`,
          );
          return {
            providerId: preferred.providerId,
            text: preferred.text,
            meta: preferred.meta || {},
          };
        }
      }

      const latest = mappingResponses[0];
      console.log(
        `[ContextResolver] Found latest mapping output from ${latest.providerId}`,
      );
      return {
        providerId: latest.providerId,
        text: latest.text,
        meta: latest.meta || {},
      };
    } catch (e) {
      console.warn("[ContextResolver] _findLatestMappingOutput failed:", e);
      return null;
    }
  }
  /**
   * Find the latest valid synthesis output among provider responses for a turn.
   * Used for mapping recompute to reference historical synthesis.
   */
  _findLatestSynthesisOutput(providerResponses = []) {
    try {
      if (!providerResponses || providerResponses.length === 0) {
        return null;
      }

      const synthesisResponses = providerResponses.filter(
        (r) =>
          r &&
          r.responseType === "synthesis" &&
          r.text &&
          String(r.text).trim().length > 0,
      );

      if (synthesisResponses.length === 0) {
        return null;
      }

      // Sort by most recent update
      synthesisResponses.sort(
        (a, b) =>
          (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0),
      );

      const latest = synthesisResponses[0];
      console.log(
        `[ContextResolver] Found latest synthesis output from ${latest.providerId}`,
      );
      return {
        providerId: latest.providerId,
        text: latest.text,
        meta: latest.meta || {},
      };
    } catch (e) {
      console.warn("[ContextResolver] _findLatestSynthesisOutput failed:", e);
      return null;
    }
  }
}
