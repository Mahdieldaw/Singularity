// Enhanced SessionManager with Persistence Adapter Integration
// Supports both legacy chrome.storage and new persistence layer via feature flag

import { SimpleIndexedDBAdapter } from "./SimpleIndexedDBAdapter.js";

// Global session cache (maintains backward compatibility)
const __HTOS_SESSIONS = (self.__HTOS_SESSIONS = self.__HTOS_SESSIONS || {});

export class SessionManager {
  constructor() {
    this.sessions = __HTOS_SESSIONS;
    this.storageKey = "htos_sessions";
    this.isExtensionContext = false;

    // Persistence layer components will be injected
    this.adapter = null;
    this.isInitialized = false;
  }

  /**
   * NEW: Primary persistence entry point (Phase 4)
   * Routes to appropriate primitive-specific handler
   * @param {Object} request - { type, sessionId, userMessage, sourceTurnId?, stepType?, targetProvider? }
   * @param {Object} context - ResolvedContext from ContextResolver
   * @param {Object} result - { batchOutputs, synthesisOutputs, mappingOutputs }
   * @returns {Promise<{sessionId, userTurnId?, aiTurnId?}>}
   */
  async persist(request, context, result) {
    if (!request?.type)
      throw new Error("[SessionManager] persist() requires request.type");
    switch (request.type) {
      case "initialize":
        return this._persistInitialize(request, result);
      case "extend":
        return this._persistExtend(request, context, result);
      case "recompute":
        return this._persistRecompute(request, context, result);
      default:
        throw new Error(
          `[SessionManager] Unknown request type: ${request.type}`,
        );
    }
  }

  /**
   * Initialize: Create new session + first turn
   */
  async _persistInitialize(request, result) {
    const sessionId = request.sessionId;
    if (!sessionId) {
      throw new Error("[SessionManager] initialize requires request.sessionId");
    }
    const now = Date.now();

    // 1) Create session
    const sessionRecord = {
      id: sessionId,
      title: String(request.userMessage || "").slice(0, 50),
      createdAt: now,
      lastActivity: now,
      defaultThreadId: "default-thread",
      activeThreadId: "default-thread",
      turnCount: 2,
      isActive: true,
      lastTurnId: null,
      updatedAt: now,
      userId: "default-user",
      provider: "multi",
    };
    await this.adapter.put("sessions", sessionRecord);

    // 2) Default thread
    const defaultThread = {
      id: "default-thread",
      sessionId,
      parentThreadId: null,
      branchPointTurnId: null,
      title: "Main Thread",
      name: "Main Thread",
      color: "#6366f1",
      isActive: true,
      createdAt: now,
      lastActivity: now,
      updatedAt: now,
    };
    await this.adapter.put("threads", defaultThread);

    // 3) User turn
    const userTurnId = request.canonicalUserTurnId || `user-${now}`;
    const userTurnRecord = {
      id: userTurnId,
      type: "user",
      role: "user",
      sessionId,
      threadId: "default-thread",
      createdAt: now,
      updatedAt: now,
      content: request.userMessage || "",
      sequence: 0,
    };
    await this.adapter.put("turns", userTurnRecord);

    // 4) AI turn with contexts
    const aiTurnId = request.canonicalAiTurnId || `ai-${now}`;
    const providerContexts = this._extractContextsFromResult(result);
    const aiTurnRecord = {
      id: aiTurnId,
      type: "ai",
      role: "assistant",
      sessionId,
      threadId: "default-thread",
      userTurnId,
      createdAt: now,
      updatedAt: now,
      providerContexts,
      isComplete: true,
      sequence: 1,
      batchResponseCount: this.countResponses(result.batchOutputs),
      synthesisResponseCount: this.countResponses(result.synthesisOutputs),
      mappingResponseCount: this.countResponses(result.mappingOutputs),
      meta: await this._attachRunIdMeta(aiTurnId),
    };
    await this.adapter.put("turns", aiTurnRecord);

    // 5) Provider responses
    await this._persistProviderResponses(sessionId, aiTurnId, result, now);

    // 6) Update session lastTurnId
    sessionRecord.lastTurnId = aiTurnId;
    sessionRecord.updatedAt = now;
    await this.adapter.put("sessions", sessionRecord);

    // 7) Update lightweight session cache (metadata only)
    this.sessions[sessionId] = {
      id: sessionRecord.id,
      title: sessionRecord.title,
      createdAt: sessionRecord.createdAt,
      updatedAt: sessionRecord.updatedAt,
      lastTurnId: sessionRecord.lastTurnId,
      lastActivity: sessionRecord.updatedAt || now,
    };

    return { sessionId, userTurnId, aiTurnId };
  }

  /**
   * Extend: Append turn to existing session
   */
  async _persistExtend(request, context, result) {
    const { sessionId } = request;
    const now = Date.now();

    // Validate last turn
    if (!context?.lastTurnId) {
      throw new Error("[SessionManager] Extend requires context.lastTurnId");
    }
    const lastTurn = await this.adapter.get("turns", context.lastTurnId);
    if (!lastTurn)
      throw new Error(
        `[SessionManager] Last turn ${context.lastTurnId} not found`,
      );

    // Determine next sequence using session.turnCount when available (avoid full-store scan)
    let nextSequence = 0;
    try {
      const session = await this.adapter.get("sessions", sessionId);
      if (session && typeof session.turnCount === "number") {
        nextSequence = session.turnCount;
      } else {
        // Indexed fallback: compute from turns using adapter.getTurnsBySessionId
        const sessionTurns = await this.adapter.getTurnsBySessionId(sessionId);
        nextSequence = Array.isArray(sessionTurns) ? sessionTurns.length : 0;
      }
    } catch (e) {
      // Conservative fallback on error
      try {
        const sessionTurns = await this.adapter.getTurnsBySessionId(sessionId);
        nextSequence = Array.isArray(sessionTurns) ? sessionTurns.length : 0;
      } catch (_) {
        nextSequence = 0;
      }
    }

    // 1) User turn
    const userTurnId = request.canonicalUserTurnId || `user-${now}`;
    const userTurnRecord = {
      id: userTurnId,
      type: "user",
      role: "user",
      sessionId,
      threadId: "default-thread",
      createdAt: now,
      updatedAt: now,
      content: request.userMessage || "",
      sequence: nextSequence,
    };
    await this.adapter.put("turns", userTurnRecord);

    // 2) Merge contexts
    const newContexts = this._extractContextsFromResult(result);
    const mergedContexts = {
      ...(lastTurn.providerContexts || {}),
      ...newContexts,
    };

    // 3) AI turn
    const aiTurnId = request.canonicalAiTurnId || `ai-${now}`;
    const aiTurnRecord = {
      id: aiTurnId,
      type: "ai",
      role: "assistant",
      sessionId,
      threadId: "default-thread",
      userTurnId,
      createdAt: now,
      updatedAt: now,
      providerContexts: mergedContexts,
      isComplete: true,
      sequence: nextSequence + 1,
      batchResponseCount: this.countResponses(result.batchOutputs),
      synthesisResponseCount: this.countResponses(result.synthesisOutputs),
      mappingResponseCount: this.countResponses(result.mappingOutputs),
      meta: await this._attachRunIdMeta(aiTurnId),
    };
    await this.adapter.put("turns", aiTurnRecord);

    // 4) Provider responses
    await this._persistProviderResponses(sessionId, aiTurnId, result, now);

    // 5) Update session
    const session = await this.adapter.get("sessions", sessionId);
    if (session) {
      session.lastTurnId = aiTurnId;
      session.lastActivity = now;
      // If session.turnCount was previously undefined, use nextSequence + 2 (the accurate total after this extend)
      const computedNewCount =
        typeof session.turnCount === "number"
          ? session.turnCount + 2
          : nextSequence + 2;
      session.turnCount = computedNewCount;
      session.updatedAt = now;
      await this.adapter.put("sessions", session);
    }

    // 6) Update lightweight session cache (metadata only)
    this.sessions[sessionId] = {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      lastTurnId: session.lastTurnId,
      lastActivity: session.lastActivity,
    };

    return { sessionId, userTurnId, aiTurnId };
  }

  /**
   * Recompute: Create derived turn (timeline branch)
   */
  async _persistRecompute(request, context, result) {
    const { sessionId, sourceTurnId, stepType, targetProvider } = request;
    const now = Date.now();

    // 1) Source turn exists?
    const sourceTurn = await this.adapter.get("turns", sourceTurnId);
    if (!sourceTurn)
      throw new Error(`[SessionManager] Source turn ${sourceTurnId} not found`);

    // 2) Derived AI turn (off-timeline)
    const aiTurnId = request.canonicalAiTurnId || `ai-recompute-${now}`;
    const aiTurnRecord = {
      id: aiTurnId,
      type: "ai",
      role: "assistant",
      sessionId,
      threadId: "default-thread",
      userTurnId: sourceTurn.userTurnId || sourceTurnId,
      createdAt: now,
      updatedAt: now,
      providerContexts: context?.providerContextsAtSourceTurn || {},
      isComplete: true,
      sequence: -1,
      batchResponseCount: 0,
      synthesisResponseCount: stepType === "synthesis" ? 1 : 0,
      mappingResponseCount: stepType === "mapping" ? 1 : 0,
      meta: {
        isHistoricalRerun: true,
        recomputeMetadata: { stepType, targetProvider },
        ...(await this._attachRunIdMeta(aiTurnId)),
      },
    };
    await this.adapter.put("turns", aiTurnRecord);

    // 3) Persist only recomputed response
    const responseData =
      stepType === "synthesis"
        ? result.synthesisOutputs?.[targetProvider]
        : result.mappingOutputs?.[targetProvider];
    if (responseData) {
      const respId = `pr-${sessionId}-${aiTurnId}-${targetProvider}-${stepType}-0-${now}`;
      await this.adapter.put("provider_responses", {
        id: respId,
        sessionId,
        aiTurnId,
        providerId: targetProvider,
        responseType: stepType,
        responseIndex: 0,
        text: responseData?.text || "",
        status: responseData?.status || "completed",
        meta: responseData?.meta || {},
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      });
    } else {
      console.warn(
        `[SessionManager] No ${stepType} output found for ${targetProvider}`,
      );
    }

    // 4) Do NOT update session.lastTurnId (branch)

    // 5) No legacy cache updates for recompute; do not change session cache

    return { sessionId, aiTurnId };
  }

  /**
   * Extract provider contexts from workflow result
   */
  _extractContextsFromResult(result) {
    const contexts = {};
    try {
      Object.entries(result?.batchOutputs || {}).forEach(([pid, output]) => {
        if (output?.meta && Object.keys(output.meta).length > 0)
          contexts[pid] = output.meta;
      });
      Object.entries(result?.synthesisOutputs || {}).forEach(
        ([pid, output]) => {
          if (output?.meta && Object.keys(output.meta).length > 0)
            contexts[pid] = output.meta;
        },
      );
      Object.entries(result?.mappingOutputs || {}).forEach(([pid, output]) => {
        if (output?.meta && Object.keys(output.meta).length > 0)
          contexts[pid] = output.meta;
      });
    } catch (_) {}
    return contexts;
  }

  /**
   * Helper: Persist provider responses for a turn
   */
  async _persistProviderResponses(sessionId, aiTurnId, result, now) {
    let count = 0;
    // Batch
    for (const [providerId, output] of Object.entries(
      result?.batchOutputs || {},
    )) {
      const respId = `pr-${sessionId}-${aiTurnId}-${providerId}-batch-0-${now}-${count++}`;
      await this.adapter.put("provider_responses", {
        id: respId,
        sessionId,
        aiTurnId,
        providerId,
        responseType: "batch",
        responseIndex: 0,
        text: output?.text || "",
        status: output?.status || "completed",
        meta: output?.meta || {},
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      });
    }
    // Synthesis
    for (const [providerId, output] of Object.entries(
      result?.synthesisOutputs || {},
    )) {
      const respId = `pr-${sessionId}-${aiTurnId}-${providerId}-synthesis-0-${now}-${count++}`;
      await this.adapter.put("provider_responses", {
        id: respId,
        sessionId,
        aiTurnId,
        providerId,
        responseType: "synthesis",
        responseIndex: 0,
        text: output?.text || "",
        status: output?.status || "completed",
        meta: output?.meta || {},
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      });
    }
    // Mapping
    for (const [providerId, output] of Object.entries(
      result?.mappingOutputs || {},
    )) {
      const respId = `pr-${sessionId}-${aiTurnId}-${providerId}-mapping-0-${now}-${count++}`;
      await this.adapter.put("provider_responses", {
        id: respId,
        sessionId,
        aiTurnId,
        providerId,
        responseType: "mapping",
        responseIndex: 0,
        text: output?.text || "",
        status: output?.status || "completed",
        meta: output?.meta || {},
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      });
    }
  }

  /**
   * Append provider responses (mapping/synthesis/batch) to an existing AI turn
   * that follows the given historical user turn. Used to persist historical reruns
   * without creating a new user/ai turn pair.
   * additions shape: { batchResponses?, synthesisResponses?, mappingResponses? }
   */

  /**
 

  /**
   * Helper function to count responses in a response bucket
   * @param {Object} responseBucket - Object containing provider responses
   * @returns {number} Total count of responses
   */
  countResponses(responseBucket) {
    return responseBucket ? Object.values(responseBucket).flat().length : 0;
  }

  /**
   * Initialize the session manager.
   * It now accepts the persistence adapter as an argument.
   */
  async initialize(config = {}) {
    const { adapter = null, initTimeoutMs = 8000 } = config || {};

    console.log("[SessionManager] Initializing with persistence adapter...");

    if (adapter) {
      this.adapter = adapter;
    } else {
      // Create and initialize SimpleIndexedDBAdapter
      this.adapter = new SimpleIndexedDBAdapter();
      await this.adapter.init({ timeoutMs: initTimeoutMs, autoRepair: true });
    }

    this.isInitialized = true;

    // Migrations removed; adapter initialization completes without migration step
  }

  async _attachRunIdMeta(aiTurnId) {
    try {
      const metas = await this.adapter.getMetadataByEntityId(aiTurnId);
      const inflight = (metas || []).find(
        (m) => m && m.type === "inflight_workflow",
      );
      if (inflight && inflight.runId) {
        return { runId: inflight.runId };
      }
    } catch (_) {}
    return {};
  }

  /**
   * Get or create a session (persistence-backed with cache)
   */
  async getOrCreateSession(sessionId) {
    if (!sessionId) throw new Error("sessionId required");

    // 1. Check in-memory cache first
    if (this.sessions?.[sessionId]) {
      console.log(`[SessionManager] Cache hit for session: ${sessionId}`);
      return this.sessions[sessionId];
    }

    // 2. Fallback to persistence-backed retrieval/creation
    console.log(
      `[SessionManager] Cache miss for session: ${sessionId}. Fetching from DB...`,
    );

    try {
      // Try to get existing session from DB
      let sessionRecord = await this.adapter.get("sessions", sessionId);

      // Create new session if doesn't exist
      if (!sessionRecord) {
        sessionRecord = {
          id: sessionId,
          userId: "default-user",
          provider: "multi",
          title: "",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastTurnId: null,
          lastActivity: Date.now(),
        };

        await this.adapter.put("sessions", sessionRecord);

        // Create default thread
        const defaultThread = {
          id: "default-thread",
          sessionId: sessionId,
          parentThreadId: null,
          branchPointTurnId: null,
          title: "Main Thread",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        await this.adapter.put("threads", defaultThread);
      }

      // Build lightweight session metadata for cache/UI
      const lightweightSession = {
        id: sessionRecord.id,
        title: sessionRecord.title,
        createdAt: sessionRecord.createdAt,
        updatedAt: sessionRecord.updatedAt,
        lastTurnId: sessionRecord.lastTurnId || null,
        lastActivity:
          sessionRecord.lastActivity ||
          sessionRecord.updatedAt ||
          sessionRecord.createdAt,
      };

      // Update cache
      this.sessions[sessionId] = lightweightSession;

      return lightweightSession;
    } catch (error) {
      console.error(
        `[SessionManager] Failed to get/create session ${sessionId}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Save session (enhanced with persistence layer support)
   */
  async saveSession(sessionId) {
    try {
      const session = this.sessions[sessionId];
      if (!session) return;

      // Update session record
      const sessionRecord = await this.adapter.get("sessions", sessionId);
      if (sessionRecord) {
        sessionRecord.title = session.title;
        sessionRecord.updatedAt = Date.now();
        await this.adapter.put("sessions", sessionRecord);
      }

      console.log(
        `[SessionManager] Saved session ${sessionId} to persistence layer`,
      );
    } catch (error) {
      console.error(
        `[SessionManager] Failed to save session ${sessionId} to persistence layer:`,
        error,
      );
    }
  }

  // addTurn() and addTurnWithPersistence() removed. Use persist() primitives.

  /**
   * Delete session (enhanced with persistence layer support)
   */
  async deleteSession(sessionId) {
    try {
      // Perform an atomic, indexed cascade delete inside a single transaction
      await this.adapter.transaction(
        [
          "sessions",
          "threads",
          "turns",
          "provider_responses",
          "provider_contexts",
          "metadata",
        ],
        "readwrite",
        async (tx) => {
          const getAllByIndex = (store, indexName, key) =>
            new Promise((resolve, reject) => {
              let idx;
              try {
                idx = store.index(indexName);
              } catch (e) {
                return reject(e);
              }
              const req = idx.getAll(key);
              req.onsuccess = () => resolve(req.result || []);
              req.onerror = () => reject(req.error);
            });

          // 1) Delete session record
          await new Promise((resolve, reject) => {
            const req = tx.objectStore("sessions").delete(sessionId);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
          });

          // 2) Threads by session
          const threadsStore = tx.objectStore("threads");
          const threads = await getAllByIndex(
            threadsStore,
            "bySessionId",
            sessionId,
          );
          for (const t of threads) {
            await new Promise((resolve, reject) => {
              const req = threadsStore.delete(t.id);
              req.onsuccess = () => resolve(true);
              req.onerror = () => reject(req.error);
            });
          }

          // 3) Turns by session
          const turnsStore = tx.objectStore("turns");
          const turns = await getAllByIndex(
            turnsStore,
            "bySessionId",
            sessionId,
          );
          for (const turn of turns) {
            await new Promise((resolve, reject) => {
              const req = turnsStore.delete(turn.id);
              req.onsuccess = () => resolve(true);
              req.onerror = () => reject(req.error);
            });
          }

          // 4) Provider responses by sessionId (indexed; no fallbacks)
          const responsesStore = tx.objectStore("provider_responses");
          const responses = await getAllByIndex(
            responsesStore,
            "bySessionId",
            sessionId,
          );
          for (const r of responses) {
            await new Promise((resolve, reject) => {
              const req = responsesStore.delete(r.id);
              req.onsuccess = () => resolve(true);
              req.onerror = () => reject(req.error);
            });
          }

          // 5) Provider contexts by session (composite key delete)
          const contextsStore = tx.objectStore("provider_contexts");
          const contexts = await getAllByIndex(
            contextsStore,
            "bySessionId",
            sessionId,
          );
          for (const ctx of contexts) {
            await new Promise((resolve, reject) => {
              const key = [ctx.sessionId, ctx.providerId];
              const req = contextsStore.delete(key);
              req.onsuccess = () => resolve(true);
              req.onerror = () => reject(req.error);
            });
          }

          // 6) Metadata scoped to this session (indexed by sessionId; avoid full-store scans)
          const metaStore = tx.objectStore("metadata");
          const metasBySession = await getAllByIndex(
            metaStore,
            "bySessionId",
            sessionId,
          );
          for (const m of metasBySession) {
            await new Promise((resolve, reject) => {
              const req = metaStore.delete(m.key);
              req.onsuccess = () => resolve(true);
              req.onerror = () => reject(req.error);
            });
          }
        },
      );

      // Remove lightweight cache entry outside the transaction
      if (this.sessions[sessionId]) {
        delete this.sessions[sessionId];
      }

      return true;
    } catch (error) {
      console.error(
        `[SessionManager] Failed to delete session ${sessionId} from persistence layer:`,
        error,
      );
      return false;
    }
  }

  /**
   * Legacy delete session method
   */

  /**
   * Update provider context (enhanced with persistence layer support)
   */
  async updateProviderContext(
    sessionId,
    providerId,
    result = true,
    options = {},
  ) {
    const { skipSave = true } = options;
    if (!sessionId || !providerId) return;

    try {
      const session = await this.getOrCreateSession(sessionId);

      // Get or create provider context via indexed query by session
      let contexts = [];
      try {
        contexts = await this.adapter.getContextsBySessionId(sessionId);
        // Narrow to target provider
        contexts = contexts.filter(
          (context) => context.providerId === providerId,
        );
      } catch (e) {
        console.warn(
          "[SessionManager] updateProviderContext: contexts lookup failed, using empty set",
          e,
        );
        contexts = [];
      }
      // Select the most recent context by updatedAt (fallback createdAt)
      let contextRecord = null;
      if (contexts.length > 0) {
        const sorted = contexts.sort((a, b) => {
          const ta = a.updatedAt ?? a.createdAt ?? 0;
          const tb = b.updatedAt ?? b.createdAt ?? 0;
          return tb - ta; // newest first
        });
        contextRecord = sorted[0];
        console.log(
          `[SessionManager] updateProviderContext: selected latest context for ${providerId} in ${sessionId}`,
          {
            candidates: contexts.length,
            selectedId: contextRecord.id,
            selectedUpdatedAt: contextRecord.updatedAt,
            selectedCreatedAt: contextRecord.createdAt,
          },
        );
      }

      if (!contextRecord) {
        // Create new context
        contextRecord = {
          id: `ctx-${sessionId}-${providerId}-${Date.now()}`,
          sessionId: sessionId,
          providerId: providerId,
          threadId: "default-thread",
          contextData: {},
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      }

      // Update context data
      const existingContext = contextRecord.contextData || {};
      contextRecord.contextData = {
        ...existingContext,
        text: result?.text || existingContext.text || "",
        meta: { ...(existingContext.meta || {}), ...(result?.meta || {}) },
        lastUpdated: Date.now(),
      };
      contextRecord.updatedAt = Date.now();

      // Save or update context
      await this.adapter.put("provider_contexts", contextRecord);

      // Update legacy session for compatibility
      session.providers = session.providers || {};
      session.providers[providerId] = contextRecord.contextData;
      session.lastActivity = Date.now();

      if (!skipSave) {
        await this.saveSession(sessionId);
      }
    } catch (error) {
      console.error(
        `[SessionManager] Failed to update provider context in persistence layer:`,
        error,
      );
    }
  }

  /**
   * Batch update multiple provider contexts in a single pass.
   * updates shape: { [providerId]: { text?: string, meta?: object } }
   */
  async updateProviderContextsBatch(sessionId, updates = true, options = {}) {
    const { skipSave = true } = options;
    if (!sessionId || !updates || typeof updates !== "object") return;

    try {
      const session = await this.getOrCreateSession(sessionId);
      const now = Date.now();

      // Load all existing contexts once using indexed query, pick latest per provider
      let sessionContexts = [];
      try {
        sessionContexts = await this.adapter.getContextsBySessionId(sessionId);
      } catch (e) {
        console.warn(
          "[SessionManager] updateProviderContextsBatch: contexts lookup failed; proceeding with empty list",
          e,
        );
        sessionContexts = [];
      }
      const latestByProvider = {};
      for (const ctx of sessionContexts) {
        const pid = ctx.providerId;
        const ts = ctx.updatedAt ?? ctx.createdAt ?? 0;
        const existing = latestByProvider[pid];
        if (!existing || ts > (existing._ts || 0)) {
          latestByProvider[pid] = { record: ctx, _ts: ts };
        }
      }

      // Apply updates
      for (const [providerId, result] of Object.entries(updates)) {
        let contextRecord = latestByProvider[providerId]?.record;
        if (!contextRecord) {
          contextRecord = {
            id: `ctx-${sessionId}-${providerId}-${now}-${Math.random().toString(36).slice(2, 8)}`,
            sessionId,
            providerId,
            threadId: "default-thread",
            contextData: {},
            isActive: true,
            createdAt: now,
            updatedAt: now,
          };
        }

        const existingData = contextRecord.contextData || {};
        contextRecord.contextData = {
          ...existingData,
          text: result?.text || existingData.text || "",
          meta: { ...(existingData.meta || {}), ...(result?.meta || {}) },
          lastUpdated: now,
        };
        contextRecord.updatedAt = now;

        // Persist updated context
        await this.adapter.put("provider_contexts", contextRecord);

        // Update legacy session cache
        session.providers = session.providers || {};
        session.providers[providerId] = contextRecord.contextData;
      }

      session.lastActivity = now;
      if (!skipSave) {
        await this.saveSession(sessionId);
      }
    } catch (error) {
      console.error(
        "[SessionManager] Failed to batch update provider contexts:",
        error,
      );
    }
  }

  /**
   * Legacy update provider context method
   */

  /**
   * Get provider contexts (persistence-backed, backward compatible shape)
   * Returns an object: { [providerId]: { meta: <contextMeta> } }
   */
  async getProviderContexts(sessionId, threadId = "default-thread") {
    try {
      if (!sessionId) {
        console.warn(
          "[SessionManager] getProviderContexts called without sessionId",
        );
        return {};
      }
      if (!this.adapter || !this.adapter.isReady()) {
        console.warn(
          "[SessionManager] getProviderContexts called but adapter is not ready",
        );
        return {}; // Return empty if DB isn't available
      }

      // Use the fast, indexed method. No more turn scanning.
      const contextRecords =
        await this.adapter.getContextsBySessionId(sessionId);

      const contexts = {};
      for (const record of contextRecords) {
        // The goal is to return an object shaped like: { [providerId]: { meta: {...} } }
        if (record.providerId && record.contextData?.meta) {
          contexts[record.providerId] = { meta: record.contextData.meta };
        }
      }

      return contexts;
    } catch (e) {
      console.error("[SessionManager] getProviderContexts failed:", e);
      return {}; // Return empty on error
    }
  }

  // createThread* and switchThread* removed. Thread operations will be handled by persist() primitives in future phases.

  /**
   * Get stored turn by id (backward compatible)
   */
  getTurn(sessionId, turnId) {
    const session = this.sessions[sessionId];
    if (!session) return null;
    return (session.turns || []).find((t) => t.id === turnId) || null;
  }

  /**
   * Get all turns for a session (backward compatible)
   */
  getTurns(sessionId) {
    const session = this.sessions[sessionId];
    if (!session) return [];
    return session.turns || [];
  }
  // saveTurn() removed. Use persist() primitives.

  // saveTurnWithPersistence() removed. Use persist() primitives.

  /**
   * Get persistence adapter status
   */
  getPersistenceStatus() {
    return {
      persistenceEnabled: true,
      isInitialized: this.isInitialized,
      adapterReady: this.adapter?.isReady() || false,
    };
  }
}
