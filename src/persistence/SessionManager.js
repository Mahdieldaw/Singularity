// Enhanced SessionManager with Persistence Adapter Integration
// Supports both legacy chrome.storage and new persistence layer via feature flag

import { SimpleIndexedDBAdapter } from './SimpleIndexedDBAdapter.js';

// Global session cache (maintains backward compatibility)
const __HTOS_SESSIONS = (self.__HTOS_SESSIONS = self.__HTOS_SESSIONS || {});

export class SessionManager {
  constructor() {
    this.sessions = __HTOS_SESSIONS;
    this.storageKey = 'htos_sessions';
    this.isExtensionContext = false;
    this.usePersistenceAdapter = true; // always on
    
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
    if (!request?.type) throw new Error('[SessionManager] persist() requires request.type');
    switch (request.type) {
      case 'initialize':
        return this._persistInitialize(request, result);
      case 'extend':
        return this._persistExtend(request, context, result);
      case 'recompute':
        return this._persistRecompute(request, context, result);
      default:
        throw new Error(`[SessionManager] Unknown request type: ${request.type}`);
    }
  }

  /**
   * Initialize: Create new session + first turn
   */
  async _persistInitialize(request, result) {
    const sessionId = request.sessionId;
    if (!sessionId) {
      throw new Error('[SessionManager] initialize requires request.sessionId');
    }
    const now = Date.now();

    // 1) Create session
    const sessionRecord = {
      id: sessionId,
      title: String(request.userMessage || '').slice(0, 50),
      createdAt: now,
      lastActivity: now,
      defaultThreadId: 'default-thread',
      activeThreadId: 'default-thread',
      turnCount: 2,
      isActive: true,
      lastTurnId: null,
      updatedAt: now,
      userId: 'default-user',
      provider: 'multi'
    };
    await this.adapter.put('sessions', sessionRecord);

    // 2) Default thread
    const defaultThread = {
      id: 'default-thread',
      sessionId,
      parentThreadId: null,
      branchPointTurnId: null,
      title: 'Main Thread',
      name: 'Main Thread',
      color: '#6366f1',
      isActive: true,
      createdAt: now,
      lastActivity: now,
      updatedAt: now
    };
    await this.adapter.put('threads', defaultThread);

    // 3) User turn
    const userTurnId = request.canonicalUserTurnId || `user-${now}`;
    const userTurnRecord = {
      id: userTurnId,
      type: 'user',
      role: 'user',
      sessionId,
      threadId: 'default-thread',
      createdAt: now,
      updatedAt: now,
      content: request.userMessage || '',
      sequence: 0
    };
    await this.adapter.put('turns', userTurnRecord);

    // 4) AI turn with contexts
    const aiTurnId = request.canonicalAiTurnId || `ai-${now}`;
    const providerContexts = this._extractContextsFromResult(result);
    const aiTurnRecord = {
      id: aiTurnId,
      type: 'ai',
      role: 'assistant',
      sessionId,
      threadId: 'default-thread',
      userTurnId,
      createdAt: now,
      updatedAt: now,
      providerContexts,
      sequence: 1,
      batchResponseCount: this.countResponses(result.batchOutputs),
      synthesisResponseCount: this.countResponses(result.synthesisOutputs),
      mappingResponseCount: this.countResponses(result.mappingOutputs)
    };
    await this.adapter.put('turns', aiTurnRecord);

    // 5) Provider responses
    await this._persistProviderResponses(sessionId, aiTurnId, result, now);

    // 6) Update session lastTurnId
    sessionRecord.lastTurnId = aiTurnId;
    sessionRecord.updatedAt = now;
    await this.adapter.put('sessions', sessionRecord);

    // 7) Update lightweight session cache (metadata only)
    this.sessions[sessionId] = {
      id: sessionRecord.id,
      title: sessionRecord.title,
      createdAt: sessionRecord.createdAt,
      updatedAt: sessionRecord.updatedAt,
      lastTurnId: sessionRecord.lastTurnId,
      lastActivity: sessionRecord.updatedAt || now
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
      throw new Error('[SessionManager] Extend requires context.lastTurnId');
    }
    const lastTurn = await this.adapter.get('turns', context.lastTurnId);
    if (!lastTurn) throw new Error(`[SessionManager] Last turn ${context.lastTurnId} not found`);

    // Determine next sequence using session.turnCount when available (avoids full-store scan)
    let nextSequence = 0;
    try {
      const session = await this.adapter.get('sessions', sessionId);
      if (session && typeof session.turnCount === 'number') {
        nextSequence = session.turnCount;
      } else {
        // Fallback: compute from turns if session metadata is missing
        const allTurns = await this.adapter.getAll('turns');
        nextSequence = allTurns.filter(t => t.sessionId === sessionId).length;
      }
    } catch (e) {
      // Conservative fallback on error
      const allTurns = await this.adapter.getAll('turns');
      nextSequence = allTurns.filter(t => t.sessionId === sessionId).length;
    }

    // 1) User turn
    const userTurnId = request.canonicalUserTurnId || `user-${now}`;
    const userTurnRecord = {
      id: userTurnId,
      type: 'user',
      role: 'user',
      sessionId,
      threadId: 'default-thread',
      createdAt: now,
      updatedAt: now,
      content: request.userMessage || '',
      sequence: nextSequence
    };
    await this.adapter.put('turns', userTurnRecord);

    // 2) Merge contexts
    const newContexts = this._extractContextsFromResult(result);
    const mergedContexts = { ...(lastTurn.providerContexts || {}), ...newContexts };

    // 3) AI turn
    const aiTurnId = request.canonicalAiTurnId || `ai-${now}`;
    const aiTurnRecord = {
      id: aiTurnId,
      type: 'ai',
      role: 'assistant',
      sessionId,
      threadId: 'default-thread',
      userTurnId,
      createdAt: now,
      updatedAt: now,
      providerContexts: mergedContexts,
      sequence: nextSequence + 1,
      batchResponseCount: this.countResponses(result.batchOutputs),
      synthesisResponseCount: this.countResponses(result.synthesisOutputs),
      mappingResponseCount: this.countResponses(result.mappingOutputs)
    };
    await this.adapter.put('turns', aiTurnRecord);

    // 4) Provider responses
    await this._persistProviderResponses(sessionId, aiTurnId, result, now);

    // 5) Update session
    const session = await this.adapter.get('sessions', sessionId);
    if (session) {
      session.lastTurnId = aiTurnId;
      session.lastActivity = now;
      session.turnCount = (session.turnCount || 0) + 2;
      session.updatedAt = now;
      await this.adapter.put('sessions', session);
    }

    // 6) Update lightweight session cache (metadata only)
    this.sessions[sessionId] = {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      lastTurnId: session.lastTurnId,
      lastActivity: session.lastActivity
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
    const sourceTurn = await this.adapter.get('turns', sourceTurnId);
    if (!sourceTurn) throw new Error(`[SessionManager] Source turn ${sourceTurnId} not found`);

    // 2) Derived AI turn (off-timeline)
    const aiTurnId = request.canonicalAiTurnId || `ai-recompute-${now}`;
    const aiTurnRecord = {
      id: aiTurnId,
      type: 'ai',
      role: 'assistant',
      sessionId,
      threadId: 'default-thread',
      userTurnId: sourceTurn.userTurnId || sourceTurnId,
      createdAt: now,
      updatedAt: now,
      providerContexts: context?.providerContextsAtSourceTurn || {},
      sequence: -1,
      batchResponseCount: 0,
      synthesisResponseCount: stepType === 'synthesis' ? 1 : 0,
      mappingResponseCount: stepType === 'mapping' ? 1 : 0,
      meta: { isHistoricalRerun: true, recomputeMetadata: { stepType, targetProvider } }
    };
    await this.adapter.put('turns', aiTurnRecord);

    // 3) Persist only recomputed response
    const responseData = stepType === 'synthesis' ? (result.synthesisOutputs?.[targetProvider]) : (result.mappingOutputs?.[targetProvider]);
    if (responseData) {
      const respId = `pr-${sessionId}-${aiTurnId}-${targetProvider}-${stepType}-0-${now}`;
      await this.adapter.put('provider_responses', {
        id: respId,
        sessionId,
        aiTurnId,
        providerId: targetProvider,
        responseType: stepType,
        responseIndex: 0,
        text: responseData?.text || '',
        status: responseData?.status || 'completed',
        meta: responseData?.meta || {},
        createdAt: now,
        updatedAt: now,
        completedAt: now
      });
    } else {
      console.warn(`[SessionManager] No ${stepType} output found for ${targetProvider}`);
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
        if (output?.meta && Object.keys(output.meta).length > 0) contexts[pid] = output.meta;
      });
      Object.entries(result?.synthesisOutputs || {}).forEach(([pid, output]) => {
        if (output?.meta && Object.keys(output.meta).length > 0) contexts[pid] = output.meta;
      });
      Object.entries(result?.mappingOutputs || {}).forEach(([pid, output]) => {
        if (output?.meta && Object.keys(output.meta).length > 0) contexts[pid] = output.meta;
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
    for (const [providerId, output] of Object.entries(result?.batchOutputs || {})) {
      const respId = `pr-${sessionId}-${aiTurnId}-${providerId}-batch-0-${now}-${count++}`;
      await this.adapter.put('provider_responses', {
        id: respId,
        sessionId,
        aiTurnId,
        providerId,
        responseType: 'batch',
        responseIndex: 0,
        text: output?.text || '',
        status: output?.status || 'completed',
        meta: output?.meta || {},
        createdAt: now,
        updatedAt: now,
        completedAt: now
      });
    }
    // Synthesis
    for (const [providerId, output] of Object.entries(result?.synthesisOutputs || {})) {
      const respId = `pr-${sessionId}-${aiTurnId}-${providerId}-synthesis-0-${now}-${count++}`;
      await this.adapter.put('provider_responses', {
        id: respId,
        sessionId,
        aiTurnId,
        providerId,
        responseType: 'synthesis',
        responseIndex: 0,
        text: output?.text || '',
        status: output?.status || 'completed',
        meta: output?.meta || {},
        createdAt: now,
        updatedAt: now,
        completedAt: now
      });
    }
    // Mapping
    for (const [providerId, output] of Object.entries(result?.mappingOutputs || {})) {
      const respId = `pr-${sessionId}-${aiTurnId}-${providerId}-mapping-0-${now}-${count++}`;
      await this.adapter.put('provider_responses', {
        id: respId,
        sessionId,
        aiTurnId,
        providerId,
        responseType: 'mapping',
        responseIndex: 0,
        text: output?.text || '',
        status: output?.status || 'completed',
        meta: output?.meta || {},
        createdAt: now,
        updatedAt: now,
        completedAt: now
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
   * Run pending data migrations in a lazy manner after adapter is initialized.
   * - Ensure sessions have lastTurnId set to latest AI turn
   * - Migrate provider contexts from provider_contexts store to latest AI turn's providerContexts if missing
   */
  // _runPendingMigrations removed; migration is complete and helpers are no longer needed.

  /**
   * Migration verification helper
   * Returns overall migration status across sessions.
   * A session is considered "migrated" when:
   *  - It has a lastTurnId pointing to the latest AI turn, and
   *  - The latest AI turn contains providerContexts with at least one provider
   */
  // getMigrationStatus removed; no longer required after migration completion.

  /**
   * Force-run migrations for all sessions.
   * This will reset the metadata flag and invoke the pending migration routine.
   */
  // forceMigrateAll removed; migration controls are no longer exposed.

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
    const {
      adapter = null,
      initTimeoutMs = 8000
    } = config || {};
    
    // Always use the persistence adapter
    this.usePersistenceAdapter = true;
    console.log('[SessionManager] Initializing with persistence adapter...');
    
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

  

  

  /**
   * Get or create a session (enhanced with persistence layer support)
   */
  async getOrCreateSession(sessionId) {
    if (!sessionId) throw new Error('sessionId required');
    // 1. Check cache first to avoid redundant DB reads
    if (this.sessions && this.sessions[sessionId]) {
      console.log(`[SessionManager] Cache hit for session: ${sessionId}`);
      return this.sessions[sessionId];
    }
    // 2. Fallback to persistence-backed retrieval/creation
    console.log(`[SessionManager] Cache miss for session: ${sessionId}. Fetching from DB...`);
    return this.getOrCreateSessionWithPersistence(sessionId);
  }

  /**
   * Get or create session using new persistence layer
   */
  async getOrCreateSessionWithPersistence(sessionId) {
    try {
      // Prefer cached session if present
      if (this.sessions && this.sessions[sessionId]) {
        console.log(`[SessionManager] (WithPersistence) Cache hit for session: ${sessionId}`);
        return this.sessions[sessionId];
      }
      // Try to get existing session
      let sessionRecord = await this.adapter.get('sessions', sessionId);
      
      if (!sessionRecord) {
        // Create new session
        sessionRecord = {
          id: sessionId,
          userId: 'default-user',
          provider: 'multi',
          title: '',
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastTurnId: null,
          lastActivity: Date.now()
        };
        
        await this.adapter.put('sessions', sessionRecord);
        
        // Create default thread
        const defaultThread = {
          id: 'default-thread',
          sessionId: sessionId,
          parentThreadId: null,
          branchPointTurnId: null,
          title: 'Main Thread',
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        
        await this.adapter.put('threads', defaultThread);
      }
      
      // Build lightweight session metadata for UI
      const lightweightSession = {
        id: sessionRecord.id,
        title: sessionRecord.title,
        createdAt: sessionRecord.createdAt,
        updatedAt: sessionRecord.updatedAt,
        lastTurnId: sessionRecord.lastTurnId || null,
        lastActivity: sessionRecord.lastActivity || sessionRecord.updatedAt || sessionRecord.createdAt
      };
      this.sessions[sessionId] = lightweightSession;
      return lightweightSession;
    } catch (error) {
      console.error(`[SessionManager] Failed to get/create session ${sessionId}:`, error);
      return null;
    }
  }



  /**
   * Save session (enhanced with persistence layer support)
   */
  async saveSession(sessionId) {
    return this.saveSessionWithPersistence(sessionId);
  }

  /**
   * Save session using new persistence layer
   */
  async saveSessionWithPersistence(sessionId) {
    try {
      const session = this.sessions[sessionId];
      if (!session) return;
      
      // Update session record
      const sessionRecord = await this.adapter.get('sessions', sessionId);
      if (sessionRecord) {
        sessionRecord.title = session.title;
        sessionRecord.updatedAt = Date.now();
        await this.adapter.put('sessions', sessionRecord);
      }
      
      console.log(`[SessionManager] Saved session ${sessionId} to persistence layer`);
    } catch (error) {
      console.error(`[SessionManager] Failed to save session ${sessionId} to persistence layer:`, error);
    }
  }


  // addTurn() and addTurnWithPersistence() removed. Use persist() primitives.


  /**
   * Delete session (enhanced with persistence layer support)
   */
  async deleteSession(sessionId) {
    return this.deleteSessionWithPersistence(sessionId);
  }

  /**
   * Delete session using new persistence layer
   */
  async deleteSessionWithPersistence(sessionId) {
    try {
      // Perform an atomic, indexed cascade delete inside a single transaction
      await this.adapter.transaction([
        'sessions',
        'threads',
        'turns',
        'provider_responses',
        'provider_contexts',
        'documents',
        'canvas_blocks',
        'ghosts',
        'metadata'
      ], 'readwrite', async (tx) => {
        const getAllByIndex = (store, indexName, key) => new Promise((resolve, reject) => {
          let idx;
          try { idx = store.index(indexName); } catch (e) { return reject(e); }
          const req = idx.getAll(key);
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        });
        const getAllFromStore = (store) => new Promise((resolve, reject) => {
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        });

        // 1) Delete session record
        await new Promise((resolve, reject) => {
          const req = tx.objectStore('sessions').delete(sessionId);
          req.onsuccess = () => resolve(true);
          req.onerror = () => reject(req.error);
        });

        // 2) Threads by session
        const threadsStore = tx.objectStore('threads');
        const threads = await getAllByIndex(threadsStore, 'bySessionId', sessionId);
        for (const t of threads) {
          await new Promise((resolve, reject) => {
            const req = threadsStore.delete(t.id);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
          });
        }

        // 3) Turns by session
        const turnsStore = tx.objectStore('turns');
        const turns = await getAllByIndex(turnsStore, 'bySessionId', sessionId);
        const aiTurnIds = [];
        for (const turn of turns) {
          if (turn && (turn.type === 'ai' || turn.role === 'assistant')) aiTurnIds.push(turn.id);
          await new Promise((resolve, reject) => {
            const req = turnsStore.delete(turn.id);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
          });
        }

        // 4) Provider responses by aiTurnId
        const responsesStore = tx.objectStore('provider_responses');
        for (const aiTurnId of aiTurnIds) {
          const rsps = await getAllByIndex(responsesStore, 'byAiTurnId', aiTurnId);
          for (const r of rsps) {
            await new Promise((resolve, reject) => {
              const req = responsesStore.delete(r.id);
              req.onsuccess = () => resolve(true);
              req.onerror = () => reject(req.error);
            });
          }
        }

        // 5) Provider contexts by session (composite key delete)
        const contextsStore = tx.objectStore('provider_contexts');
        const contexts = await getAllByIndex(contextsStore, 'bySessionId', sessionId);
        for (const ctx of contexts) {
          await new Promise((resolve, reject) => {
            const key = [ctx.sessionId, ctx.providerId];
            const req = contextsStore.delete(key);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
          });
        }

        // 6) Documents associated to session
        const documentsStore = tx.objectStore('documents');
        const docsBySource = await getAllByIndex(documentsStore, 'bySourceSessionId', sessionId);
        const docsAll = await getAllFromStore(documentsStore);
        const docsDirect = (docsAll || []).filter(d => d && d.sessionId === sessionId);
        const docs = [...docsBySource, ...docsDirect];
        const deletedDocIds = [];
        for (const doc of docs) {
          await new Promise((resolve, reject) => {
            const req = documentsStore.delete(doc.id);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
          });
          deletedDocIds.push(doc.id);
        }

        // 7) Canvas blocks by session and by document
        const blocksStore = tx.objectStore('canvas_blocks');
        const blocksBySession = await getAllByIndex(blocksStore, 'bySessionId', sessionId);
        for (const b of blocksBySession) {
          await new Promise((resolve, reject) => {
            const req = blocksStore.delete(b.id);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
          });
        }
        for (const docId of deletedDocIds) {
          const blocksByDoc = await getAllByIndex(blocksStore, 'byDocumentId', docId);
          for (const b of blocksByDoc) {
            await new Promise((resolve, reject) => {
              const req = blocksStore.delete(b.id);
              req.onsuccess = () => resolve(true);
              req.onerror = () => reject(req.error);
            });
          }
        }

        // 8) Ghosts by session and by document
        const ghostsStore = tx.objectStore('ghosts');
        const ghostsBySession = await getAllByIndex(ghostsStore, 'bySessionId', sessionId);
        for (const g of ghostsBySession) {
          await new Promise((resolve, reject) => {
            const req = ghostsStore.delete(g.id);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
          });
        }
        for (const docId of deletedDocIds) {
          const ghostsByDoc = await getAllByIndex(ghostsStore, 'byDocumentId', docId);
          for (const g of ghostsByDoc) {
            await new Promise((resolve, reject) => {
              const req = ghostsStore.delete(g.id);
              req.onsuccess = () => resolve(true);
              req.onerror = () => reject(req.error);
            });
          }
        }

        // 9) Metadata scoped to this session (no index; filter by field if present)
        const metaStore = tx.objectStore('metadata');
        const allMeta = await getAllFromStore(metaStore);
        const metas = (allMeta || []).filter(m => m && (m.sessionId === sessionId || m.entityId === sessionId));
        for (const m of metas) {
          await new Promise((resolve, reject) => {
            const req = metaStore.delete(m.key);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
          });
        }
      });

      // Remove lightweight cache entry outside the transaction
      if (this.sessions[sessionId]) {
        delete this.sessions[sessionId];
      }

      return true;
    } catch (error) {
      console.error(`[SessionManager] Failed to delete session ${sessionId} from persistence layer:`, error);
      return false;
    }
  }

  /**
   * Legacy delete session method
   */

  /**
   * Update provider context (enhanced with persistence layer support)
   */
  async updateProviderContext(sessionId, providerId, result, preserveChat = true, options = {}) {
    return this.updateProviderContextWithPersistence(sessionId, providerId, result, preserveChat, options);
  }

  /**
   * Update provider context using new persistence layer
   */
  async updateProviderContextWithPersistence(sessionId, providerId, result, preserveChat = true, options = {}) {
    const { skipSave = true } = options;
    if (!sessionId || !providerId) return;
    
    try {
      const session = await this.getOrCreateSession(sessionId);
      
      // Get or create provider context - using indexed query by session
      let contexts = [];
      try {
        if (typeof this.adapter.getContextsBySessionId === 'function') {
          contexts = await this.adapter.getContextsBySessionId(sessionId);
        } else {
          // Fallback to scanning the store
          const allContexts = await this.adapter.getAll('provider_contexts');
          contexts = allContexts.filter(context => context.sessionId === sessionId);
        }
        // Narrow to target provider
        contexts = contexts.filter(context => context.providerId === providerId);
      } catch (e) {
        console.warn('[SessionManager] updateProviderContext: contexts lookup failed, using empty set', e);
        contexts = [];
      }
      // Select the most recent context by updatedAt (fallback createdAt)
      let contextRecord = null;
      if (contexts.length > 0) {
        const sorted = contexts.sort((a, b) => {
          const ta = (a.updatedAt ?? a.createdAt ?? 0);
          const tb = (b.updatedAt ?? b.createdAt ?? 0);
          return tb - ta; // newest first
        });
        contextRecord = sorted[0];
        console.log(`[SessionManager] updateProviderContext: selected latest context for ${providerId} in ${sessionId}`, {
          candidates: contexts.length,
          selectedId: contextRecord.id,
          selectedUpdatedAt: contextRecord.updatedAt,
          selectedCreatedAt: contextRecord.createdAt
        });
      }
      
      if (!contextRecord) {
        // Create new context
        contextRecord = {
          id: `ctx-${sessionId}-${providerId}-${Date.now()}`,
          sessionId: sessionId,
          providerId: providerId,
          threadId: 'default-thread',
          contextData: {},
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
      }
      
      // Update context data
      const existingContext = contextRecord.contextData || {};
      contextRecord.contextData = {
        ...existingContext,
        text: result?.text || existingContext.text || '',
        meta: { ...(existingContext.meta || {}), ...(result?.meta || {}) },
        lastUpdated: Date.now()
      };
      contextRecord.updatedAt = Date.now();
      
      // Save or update context
      await this.adapter.put('provider_contexts', contextRecord);
      
      // Update legacy session for compatibility
      session.providers = session.providers || {};
      session.providers[providerId] = contextRecord.contextData;
      session.lastActivity = Date.now();
      
      if (!skipSave) {
        await this.saveSession(sessionId);
      }
      
    } catch (error) {
      console.error(`[SessionManager] Failed to update provider context in persistence layer:`, error);
    }
  }

  /**
   * Batch update multiple provider contexts in a single pass.
   * updates shape: { [providerId]: { text?: string, meta?: object } }
   */
  async updateProviderContextsBatch(sessionId, updates, preserveChat = true, options = {}) {
    return this.updateProviderContextsBatchWithPersistence(sessionId, updates, preserveChat, options);
  }

  async updateProviderContextsBatchWithPersistence(sessionId, updates, preserveChat = true, options = {}) {
    const { skipSave = true } = options;
    if (!sessionId || !updates || typeof updates !== 'object') return;

    try {
      const session = await this.getOrCreateSession(sessionId);
      const now = Date.now();

      // Load all existing contexts once using indexed query, pick latest per provider
      let sessionContexts = [];
      try {
        if (typeof this.adapter.getContextsBySessionId === 'function') {
          sessionContexts = await this.adapter.getContextsBySessionId(sessionId);
        } else {
          const allContexts = await this.adapter.getAll('provider_contexts');
          sessionContexts = allContexts.filter(ctx => ctx.sessionId === sessionId);
        }
      } catch (e) {
        console.warn('[SessionManager] updateProviderContextsBatch: contexts lookup failed; proceeding with empty list', e);
        sessionContexts = [];
      }
      const latestByProvider = {};
      for (const ctx of sessionContexts) {
        const pid = ctx.providerId;
        const ts = (ctx.updatedAt ?? ctx.createdAt ?? 0);
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
            id: `ctx-${sessionId}-${providerId}-${now}-${Math.random().toString(36).slice(2,8)}`,
            sessionId,
            providerId,
            threadId: 'default-thread',
            contextData: {},
            isActive: true,
            createdAt: now,
            updatedAt: now
          };
        }

        const existingData = contextRecord.contextData || {};
        contextRecord.contextData = {
          ...existingData,
          text: result?.text || existingData.text || '',
          meta: { ...(existingData.meta || {}), ...(result?.meta || {}) },
          lastUpdated: now
        };
        contextRecord.updatedAt = now;

        // Persist updated context
        await this.adapter.put('provider_contexts', contextRecord);

        // Update legacy session cache
        session.providers = session.providers || {};
        session.providers[providerId] = contextRecord.contextData;
      }

      session.lastActivity = now;
      if (!skipSave) {
        await this.saveSession(sessionId);
      }
    } catch (error) {
      console.error('[SessionManager] Failed to batch update provider contexts:', error);
    }
  }

  /**
   * Legacy update provider context method
   */

  /**
   * Get provider contexts (persistence-backed, backward compatible shape)
   * Returns an object: { [providerId]: { meta: <contextMeta> } }
   */
  async getProviderContexts(sessionId, threadId = 'default-thread') {
    try {
      if (!sessionId) return {};
      const adapterReady = !!(this.adapter && typeof this.adapter.isReady === 'function' && this.adapter.isReady());
      if (!adapterReady) {
        // Fallback to whatever the cache has (may be empty in new architecture)
        const cached = this.sessions?.[sessionId]?.providers || {};
        const contexts = {};
        for (const [pid, data] of Object.entries(cached)) {
          if (data?.meta) contexts[pid] = { meta: data.meta };
        }
        return contexts;
      }

      // Prefer the lastTurnId from the lightweight cache
      const lastTurnId = this.sessions?.[sessionId]?.lastTurnId || null;
      let aiTurn = null;
      if (lastTurnId) {
        const lastTurn = await this.adapter.get('turns', lastTurnId);
        if (lastTurn && (lastTurn.type === 'ai' || lastTurn.role === 'assistant')) {
          aiTurn = lastTurn;
        }
      }

      // If not found, scan turns for latest AI turn in this session
      if (!aiTurn) {
        let sessionTurns = [];
        try {
          if (typeof this.adapter.getTurnsBySessionId === 'function') {
            sessionTurns = await this.adapter.getTurnsBySessionId(sessionId);
          } else {
            const allTurns = await this.adapter.getAll('turns');
            sessionTurns = (allTurns || []).filter(t => t && t.sessionId === sessionId);
          }
        } catch (e) {
          console.warn('[SessionManager] getProviderContexts: turn lookup failed', e);
          sessionTurns = [];
        }
        const aiTurns = sessionTurns.filter(t => (t.type === 'ai' || t.role === 'assistant'));
        aiTurns.sort((a, b) => {
          const sa = (a.sequence ?? a.createdAt ?? 0);
          const sb = (b.sequence ?? b.createdAt ?? 0);
          return sb - sa; // newest first
        });
        aiTurn = aiTurns[0] || null;
      }

      const contexts = {};
      const metaMap = aiTurn?.providerContexts || {};
      for (const [pid, meta] of Object.entries(metaMap)) {
        if (meta && typeof meta === 'object') contexts[pid] = { meta };
      }
      return contexts;
    } catch (e) {
      // Non-fatal; return empty
      console.warn('[SessionManager] getProviderContexts failed, returning empty:', e);
      return {};
    }
  }

  // createThread* and switchThread* removed. Thread operations will be handled by persist() primitives in future phases.


  /**
   * Get stored turn by id (backward compatible)
   */
  getTurn(sessionId, turnId) {
    const session = this.sessions[sessionId];
    if (!session) return null;
    return (session.turns || []).find(t => t.id === turnId) || null;
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
      usePersistenceAdapter: true,
      isInitialized: this.isInitialized,
      adapterReady: this.adapter?.isReady() || false
    };
  }
}
