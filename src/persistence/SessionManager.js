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
  async _runPendingMigrations() {
    try {
      if (!this.adapter?.isReady || !this.adapter.isReady()) return;

      // Check metadata flag; if absent, create and proceed; if 'done', skip
      let mig = null;
      try { mig = await this.adapter.get('metadata', 'migration_1_turn_scoped_contexts'); } catch (_) {}
      const now = Date.now();
      if (!mig) {
        mig = { key: 'migration_1_turn_scoped_contexts', id: 'migration_1_turn_scoped_contexts', value: 'pending', createdAt: now, updatedAt: now };
        try { await this.adapter.put('metadata', mig); } catch (_) {}
      }
      if (mig && mig.value === 'done') return;

      const sessions = await this.adapter.getAll('sessions');
      const allTurns = await this.adapter.getAll('turns');
      const allContexts = await this.adapter.getAll('provider_contexts');

      for (const s of sessions) {
        const sid = s.id;
        const turns = allTurns.filter(t => t.sessionId === sid).sort((a,b) => (a.sequence ?? a.createdAt) - (b.sequence ?? b.createdAt));
        const latestAi = [...turns].reverse().find(t => (t.type === 'ai' || t.role === 'assistant'));
        if (!latestAi) continue;

        let updated = false;

        if (!s.lastTurnId || s.lastTurnId !== latestAi.id) {
          s.lastTurnId = latestAi.id;
          s.lastActivity = latestAi.updatedAt || latestAi.createdAt || s.lastActivity || now;
          s.updatedAt = now;
          updated = true;
        }

        // Ensure providerContexts on latest AI turn
        if (!latestAi.providerContexts || Object.keys(latestAi.providerContexts || {}).length === 0) {
          const ctxRecords = allContexts.filter(c => c.sessionId === sid);
          if (ctxRecords.length > 0) {
            const byProvider = {};
            ctxRecords.forEach(c => {
              const pid = c.providerId;
              const existing = byProvider[pid];
              const ts = (c.updatedAt ?? c.createdAt ?? 0);
              if (!existing || ts > existing._ts) {
                byProvider[pid] = { _ts: ts, data: c.contextData || c.meta || {} };
              }
            });
            const providerContexts = {};
            Object.entries(byProvider).forEach(([pid, rec]) => { providerContexts[pid] = rec.data; });
            if (Object.keys(providerContexts).length > 0) {
              latestAi.providerContexts = providerContexts;
              await this.adapter.put('turns', latestAi);
            }
          }
        }

        if (updated) {
          await this.adapter.put('sessions', s);
        }
      }

      mig.value = 'done';
      mig.updatedAt = Date.now();
      await this.adapter.put('metadata', mig);
    } catch (error) {
      console.warn('[SessionManager] Migration error:', error);
    }
  }

  /**
   * Migration verification helper
   * Returns overall migration status across sessions.
   * A session is considered "migrated" when:
   *  - It has a lastTurnId pointing to the latest AI turn, and
   *  - The latest AI turn contains providerContexts with at least one provider
   */
  async getMigrationStatus() {
    try {
      if (!this.adapter?.isReady || !this.adapter.isReady()) {
        return { total: 0, migrated: 0, pending: 0, pendingSessions: [], sessions: {} };
      }

      const sessions = await this.adapter.getAll('sessions');
      const allTurns = await this.adapter.getAll('turns');

      const details = {};
      let migrated = 0;
      let pending = 0;

      for (const s of sessions) {
        const sid = s.id;
        const turns = allTurns
          .filter(t => t.sessionId === sid)
          .sort((a,b) => (a.sequence ?? a.createdAt) - (b.sequence ?? b.createdAt));
        const latestAi = [...turns].reverse().find(t => (t.type === 'ai' || t.role === 'assistant')) || null;

        const hasLastPointer = !!(s.lastTurnId && latestAi && s.lastTurnId === latestAi.id);
        const contextsOnLatest = !!(latestAi && latestAi.providerContexts && Object.keys(latestAi.providerContexts || {}).length > 0);
        const ok = !!(latestAi && hasLastPointer && contextsOnLatest);

        details[sid] = {
          hasLastPointer,
          latestAiId: latestAi?.id || null,
          contextsOnLatest,
          migrated: ok
        };

        if (ok) migrated++; else pending++;
      }

      const pendingSessions = Object.entries(details)
        .filter(([, d]) => !d.migrated)
        .map(([sid]) => sid);

      return {
        total: sessions.length,
        migrated,
        pending,
        pendingSessions,
        sessions: details
      };
    } catch (e) {
      console.warn('[SessionManager] getMigrationStatus failed:', e);
      return { total: 0, migrated: 0, pending: 0, pendingSessions: [], sessions: {} };
    }
  }

  /**
   * Force-run migrations for all sessions.
   * This will reset the metadata flag and invoke the pending migration routine.
   */
  async forceMigrateAll() {
    try {
      if (!this.adapter?.isReady || !this.adapter.isReady()) {
        throw new Error('[SessionManager] forceMigrateAll requires initialized adapter');
      }
      let mig = null;
      try { mig = await this.adapter.get('metadata', 'migration_1_turn_scoped_contexts'); } catch (_) {}
      const now = Date.now();
      if (!mig) {
        mig = { key: 'migration_1_turn_scoped_contexts', id: 'migration_1_turn_scoped_contexts', value: 'pending', createdAt: now, updatedAt: now };
      } else {
        mig.value = 'pending';
        mig.updatedAt = now;
      }
      try { await this.adapter.put('metadata', mig); } catch (_) {}

      await this._runPendingMigrations();
      return await this.getMigrationStatus();
    } catch (e) {
      console.warn('[SessionManager] forceMigrateAll failed:', e);
      return await this.getMigrationStatus();
    }
  }

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
    console.log('[SessionManager] Persistence layer integration successful.');
    console.log('[SessionManager] Initialization complete');

    // Attempt lazy data migrations after adapter is ready
    try {
      await this._runPendingMigrations();
    } catch (e) {
      console.warn('[SessionManager] Pending migrations failed (non-fatal):', e);
    }
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


  // Legacy builder removed; sessions now use lightweight metadata only
  async buildLegacySessionObject(sessionId) {
    console.warn('[SessionManager] buildLegacySessionObject has been removed; returning null.');
    return null;
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


  /**
   * Add turn to session (enhanced with persistence layer support)
   */
  async addTurn(sessionId, userTurn, aiTurn, threadId = 'default-thread') {
    return this.addTurnWithPersistence(sessionId, userTurn, aiTurn, threadId);
  }

  /**
   * Add turn using new persistence layer
   */
  async addTurnWithPersistence(sessionId, userTurn, aiTurn, threadId = 'default-thread') {
    try {
      const session = await this.getOrCreateSession(sessionId);
      
      // Get next sequence numbers - using getAll and filtering by sessionId
      const allTurns = await this.adapter.getAll('turns');
      const existingTurns = allTurns.filter(turn => turn.sessionId === sessionId);
      let nextSequence = existingTurns.length;
      
      // Add user turn
      if (userTurn) {
        const userTurnRecord = {
          id: userTurn.id || `turn-${sessionId}-${nextSequence}`,
          sessionId: sessionId,
          threadId: threadId,
          sequence: nextSequence++,
          role: 'user',
          content: userTurn.text || '',
          createdAt: userTurn.createdAt || Date.now(),
          updatedAt: Date.now()
        };
        
        await this.adapter.put('turns', userTurnRecord);
        
        // Add to legacy session for compatibility
        session.turns = session.turns || [];
        session.turns.push({ ...userTurn, threadId });
      }
      
      // Add AI turn
      if (aiTurn) {
        const aiTurnRecord = {
          id: aiTurn.id || `turn-${sessionId}-${nextSequence}`,
          sessionId: sessionId,
          threadId: threadId,
          sequence: nextSequence,
          role: 'assistant',
          content: aiTurn.text || '',
          createdAt: aiTurn.createdAt || Date.now(),
          updatedAt: Date.now()
        };
        
        await this.adapter.put('turns', aiTurnRecord);
        
        // Add to legacy session for compatibility
        session.turns = session.turns || [];
        session.turns.push({ ...aiTurn, threadId, completedAt: Date.now() });
      }
      
      // Update session title and activity
      if (!session.title && userTurn?.text) {
        session.title = String(userTurn.text).slice(0, 50);
        const sessionRecord = await this.adapter.get('sessions', sessionId);
        if (sessionRecord) {
          sessionRecord.title = session.title;
          sessionRecord.updatedAt = Date.now();
          await this.adapter.put('sessions', sessionRecord);
        }
      }
      
      session.lastActivity = Date.now();
      
    } catch (error) {
      console.error(`[SessionManager] Failed to add turn to persistence layer:`, error);
    }
  }


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
      // Delete from persistence layer
      await this.adapter.delete('sessions', sessionId);
      
      // Delete related data - using getAll and filtering by sessionId
      const allThreads = await this.adapter.getAll('threads');
      const threads = allThreads.filter(thread => thread.sessionId === sessionId);
      for (const thread of threads) {
        await this.adapter.delete('threads', thread.id);
      }
      
      const allTurns = await this.adapter.getAll('turns');
      const turns = allTurns.filter(turn => turn.sessionId === sessionId);
      for (const turn of turns) {
        await this.adapter.delete('turns', turn.id);
      }

      // Also delete provider responses associated with this session
      try {
        const allResponses = await this.adapter.getAll('provider_responses');
        const responses = allResponses.filter(resp => resp.sessionId === sessionId);
        for (const resp of responses) {
          await this.adapter.delete('provider_responses', resp.id);
        }
      } catch (e) {
        console.warn('[SessionManager] Failed to delete provider responses for session', sessionId, e);
      }
      
      const allContexts = await this.adapter.getAll('provider_contexts');
      const contexts = allContexts.filter(context => context.sessionId === sessionId);
      for (const context of contexts) {
        await this.adapter.delete('provider_contexts', context.id);
      }
      
      // Delete from memory
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
      
      // Get or create provider context - using getAll and filtering
      const allContexts = await this.adapter.getAll('provider_contexts');
      const contexts = allContexts.filter(context => 
        context.providerId === providerId && context.sessionId === sessionId
      );
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
        const allTurns = await this.adapter.getAll('turns');
        const sessionTurns = (allTurns || []).filter(t => t && t.sessionId === sessionId);
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

  /**
   * Create thread (enhanced with persistence layer support)
   */
  async createThread(sessionId, parentThreadId = null, branchPointTurnId = null, name = null, color = '#8b5cf6') {
    return this.createThreadWithPersistence(sessionId, parentThreadId, branchPointTurnId, name, color);
  }

  /**
   * Create thread using new persistence layer
   */
  async createThreadWithPersistence(sessionId, parentThreadId = null, branchPointTurnId = null, name = null, color = '#8b5cf6') {
    try {
      const session = await this.getOrCreateSession(sessionId);
      const threadId = `thread-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Get existing threads - using getAll and filtering by sessionId
      const allThreads = await this.adapter.getAll('threads');
      const existingThreads = allThreads.filter(thread => thread.sessionId === sessionId);
      
      const threadRecord = {
        id: threadId,
        sessionId: sessionId,
        parentThreadId: parentThreadId,
        branchPointTurnId: branchPointTurnId,
        title: name || `Branch ${existingThreads.length}`,
        isActive: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      await this.adapter.put('threads', threadRecord);
      
      // Add to legacy session for compatibility
      session.threads = session.threads || {};
      session.threads[threadId] = {
        id: threadId,
        sessionId: sessionId,
        parentThreadId: parentThreadId,
        branchPointTurnId: branchPointTurnId,
        name: threadRecord.title,
        color: color || '#8b5cf6',
        isActive: false,
        createdAt: threadRecord.createdAt,
        lastActivity: threadRecord.updatedAt
      };
      
      await this.saveSession(sessionId);
      return session.threads[threadId];
    } catch (error) {
      console.error(`[SessionManager] Failed to create thread in persistence layer:`, error);
      return null;
    }
  }

  /**
   * Legacy create thread method
   */

  /**
   * Switch thread (enhanced with persistence layer support)
   */
  async switchThread(sessionId, threadId) {
    return this.switchThreadWithPersistence(sessionId, threadId);
  }

  /**
   * Switch thread using new persistence layer
   */
  async switchThreadWithPersistence(sessionId, threadId) {
    try {
      const session = this.sessions[sessionId];
      if (!session || !session.threads || !session.threads[threadId]) {
        throw new Error(`Thread ${threadId} not found in session ${sessionId}`);
      }
      
      // Update all threads in persistence layer - using getAll and filtering by sessionId
      const allThreads = await this.adapter.getAll('threads');
      const threads = allThreads.filter(thread => thread.sessionId === sessionId);
      
      for (const thread of threads) {
        const isActive = thread.id === threadId;
        const updatedThread = {
          ...thread,
          isActive: isActive,
          updatedAt: isActive ? Date.now() : thread.updatedAt
        };
        await this.adapter.put('threads', updatedThread);
      }
      
      // Update legacy session for compatibility
      Object.values(session.threads).forEach(thread => { thread.isActive = false; });
      session.threads[threadId].isActive = true;
      session.threads[threadId].lastActivity = Date.now();
      
      await this.saveSession(sessionId);
      return session.threads[threadId];
    } catch (error) {
      console.error(`[SessionManager] Failed to switch thread in persistence layer:`, error);
      return null;
    }
  }


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

  /**
   * Save turn (legacy compatibility method)
   */
  async saveTurn(sessionId, userTurn, aiTurn) {
    // Save turn (legacy compatibility wrapper)
    // Routes to new persist() method when possible
    try {
      const hasNewContexts = aiTurn?.providerContexts && Object.keys(aiTurn.providerContexts).length > 0;
      const result = {
        batchOutputs: aiTurn?.batchResponses || {},
        synthesisOutputs: aiTurn?.synthesisResponses || {},
        mappingOutputs: aiTurn?.mappingResponses || {}
      };
      // Determine primitive type based on session state
      let requestType = 'extend';
      try {
        const s = await this.adapter.get('sessions', sessionId);
        if (!s || !s.lastTurnId) requestType = 'initialize';
      } catch (_) {
        requestType = 'initialize';
      }

      if (hasNewContexts) {
        console.log('[SessionManager] saveTurn: Detected new format, routing to persist()');
        const request = { type: requestType, sessionId, userMessage: userTurn?.text || '' };
        let context = null;
        if (requestType === 'extend') {
          // Resolve lastTurnId from persistence if possible
          let lastTurnId = null;
          try {
            const allTurns = await this.adapter.getAll('turns');
            const turns = allTurns
              .filter(t => t.sessionId === sessionId)
              .sort((a,b) => (a.sequence ?? a.createdAt) - (b.sequence ?? b.createdAt));
            const latestAi = [...turns].reverse().find(t => (t.type === 'ai' || t.role === 'assistant'));
            lastTurnId = latestAi?.id || null;
          } catch (_) {}
          context = { type: 'extend', sessionId, lastTurnId, providerContexts: aiTurn.providerContexts };
        } else {
          context = { type: 'initialize', providers: Object.keys(result.batchOutputs || {}) };
        }
        return await this.persist(request, context, result);
      }

      // Fall back to legacy method
      console.log('[SessionManager] saveTurn: Using legacy persistence path');
      return this.saveTurnWithPersistence(sessionId, userTurn, aiTurn);
    } catch (e) {
      console.warn('[SessionManager] saveTurn routing failed, falling back:', e);
      return this.saveTurnWithPersistence(sessionId, userTurn, aiTurn);
    }
  }


  /**
   * Persist a complete user+AI turn and all provider responses
   */
  async saveTurnWithPersistence(sessionId, userTurn, aiTurn) {
    console.warn('[SessionManager] DEPRECATED: saveTurnWithPersistence() called. Migrate to persist().');
    try {
      // Ensure session exists and is hydrated into legacy cache
      const session = await this.getOrCreateSession(sessionId);

      // Determine next sequence
      const allTurns = await this.adapter.getAll('turns');
      const existingTurns = allTurns.filter(t => t.sessionId === sessionId);
      let nextSequence = existingTurns.length;

      const now = Date.now();

      // Persist user turn
      if (userTurn) {
        const userTurnRecord = {
          id: userTurn.id || `turn-${sessionId}-${nextSequence}`,
          type: 'user',
          role: 'user',
          sessionId,
          threadId: 'default-thread',
          createdAt: userTurn.createdAt || now,
          updatedAt: now,
          content: userTurn.text || '',
          sequence: nextSequence++
        };
        await this.adapter.put('turns', userTurnRecord);

        // Mirror in legacy cache for UI compatibility
        session.turns = session.turns || [];
        session.turns.push({ ...userTurn, threadId: 'default-thread' });
      }

      // Persist AI turn
      if (aiTurn) {
        const aiTurnId = aiTurn.id || `turn-${sessionId}-${nextSequence}`;
        const providerResponseIds = [];

        // Flatten and persist provider responses across types
        const persistResponses = async (bucket, responseType) => {
          if (!bucket) return;
          const providers = Object.keys(bucket);
          for (const providerId of providers) {
            const entries = Array.isArray(bucket[providerId]) ? bucket[providerId] : [bucket[providerId]];
            for (let idx = 0; idx < entries.length; idx++) {
              const entry = entries[idx] || {};
              const respId = `pr-${sessionId}-${aiTurnId}-${providerId}-${responseType}-${idx}-${Date.now()}`;
              const record = {
                id: respId,
                sessionId,
                aiTurnId,
                providerId,
                responseType,
                responseIndex: idx,
                text: entry.text || '',
                status: entry.status || 'completed',
                meta: entry.meta || {},
                createdAt: now,
                updatedAt: now,
                completedAt: now
              };
              await this.adapter.put('provider_responses', record);
              providerResponseIds.push(respId);
            }
          }
        };

      await persistResponses(aiTurn.batchResponses, 'batch');
      await persistResponses(aiTurn.synthesisResponses, 'synthesis');
      await persistResponses(aiTurn.mappingResponses, 'mapping');

      // Build providerContexts from batch responses meta, if present
      const providerContexts = (() => {
        const ctx = {};
        try {
          const bucket = aiTurn.batchResponses || {};
          Object.entries(bucket).forEach(([pid, r]) => {
            if (r && r.meta && Object.keys(r.meta).length > 0) {
              // Store raw meta under provider id
              ctx[pid] = r.meta;
            }
          });
        } catch (_) {}
        return Object.keys(ctx).length > 0 ? ctx : undefined;
      })();

      const aiTurnRecord = {
        id: aiTurnId,
        type: 'ai',
        role: 'assistant',
        sessionId,
        threadId: 'default-thread',
        createdAt: aiTurn.createdAt || now,
        updatedAt: now,
        content: aiTurn.text || '',
        sequence: nextSequence,
        userTurnId: userTurn?.id,
        providerResponseIds,
        batchResponseCount: this.countResponses(aiTurn.batchResponses),
        synthesisResponseCount: this.countResponses(aiTurn.synthesisResponses),
        mappingResponseCount: this.countResponses(aiTurn.mappingResponses),
        // NEW: Turn-scoped provider contexts captured from responses
        providerContexts
      };
      await this.adapter.put('turns', aiTurnRecord);

      // Mirror in legacy cache for UI compatibility
      session.turns = session.turns || [];
      session.turns.push({ ...aiTurn, threadId: 'default-thread', providerContexts });

      // Update session lastTurnId pointer for ContextResolver and lastActivity timestamp
      try {
        const sessionRecord = await this.adapter.get('sessions', sessionId);
        if (sessionRecord) {
          // Maintain title and update pointers
          sessionRecord.title = session.title;
          sessionRecord.lastTurnId = aiTurnId;
          sessionRecord.lastActivity = now;
          sessionRecord.updatedAt = now;
          await this.adapter.put('sessions', sessionRecord);
        }
        // Mirror to legacy cache
        session.lastActivity = now;
        session.lastTurnId = aiTurnId;
      } catch (e) {
        console.warn('[SessionManager] Failed to update session pointers during saveTurn:', e);
      }
      // Close the AI turn persistence block
      }
      await this.saveSession(sessionId);
    } catch (error) {
      console.error(`[SessionManager] Failed to save turn with persistence:`, error);
    }
  }

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
