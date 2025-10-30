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
   * Append provider responses (mapping/synthesis/batch) to an existing AI turn
   * that follows the given historical user turn. Used to persist historical reruns
   * without creating a new user/ai turn pair.
   * additions shape: { batchResponses?, synthesisResponses?, mappingResponses? }
   */
  async appendProviderResponses(sessionId, targetUserTurnId, additions = {}) {
    try {
      const usePA = this.usePersistenceAdapter && this.isInitialized && this.adapter?.isReady();

      // Locate AI turn following the target user turn in legacy cache first
      let session = this.sessions[sessionId];
      if (!session) {
        // Hydrate via getOrCreate to ensure legacy cache exists
        session = await this.getOrCreateSession(sessionId);
      }
      let turns = Array.isArray(session?.turns) ? session.turns : [];
      let userIdx = turns.findIndex(t => t && t.id === targetUserTurnId && (t.type === 'user' || t.role === 'user'));
      if (userIdx === -1 || !turns[userIdx + 1] || (turns[userIdx + 1].type !== 'ai' && turns[userIdx + 1].role !== 'assistant')) {
        // Relocate: search all sessions for the correct one containing targetUserTurnId
        const all = this.sessions || {};
        let relocated = null;
        for (const [sid, s] of Object.entries(all)) {
          const arr = Array.isArray(s?.turns) ? s.turns : [];
          const idx = arr.findIndex(t => t && t.id === targetUserTurnId && (t.type === 'user' || t.role === 'user'));
          if (idx !== -1 && arr[idx + 1] && (arr[idx + 1].type === 'ai' || arr[idx + 1].role === 'assistant')) {
            sessionId = sid; // update to correct session
            session = s;
            turns = arr;
            userIdx = idx;
            relocated = sid;
            break;
          }
        }
        if (!relocated) {
          console.warn(`[SessionManager] appendProviderResponses: AI turn not found after userTurn ${targetUserTurnId} in any session`);
          return false;
        }
        console.warn(`[SessionManager] appendProviderResponses: relocated to session ${relocated} for userTurn ${targetUserTurnId}`);
      }
      const aiTurn = turns[userIdx + 1];

      const now = Date.now();
      const ensureArrayBucket = (obj, key) => { if (!obj[key]) obj[key] = []; return obj[key]; };

      const persistBucket = async (bucket, responseType) => {
        if (!bucket) return;
        for (const [providerId, value] of Object.entries(bucket)) {
          const entries = Array.isArray(value) ? value : [value];
          for (let idx = 0; idx < entries.length; idx++) {
            const entry = entries[idx] || {};
            // Update legacy mirror
            if (responseType === 'mapping') {
              const arr = ensureArrayBucket(aiTurn.mappingResponses = (aiTurn.mappingResponses || {}), providerId);
              arr.push({ providerId, text: entry.text || '', status: entry.status || 'completed', meta: entry.meta || {} });
            } else if (responseType === 'synthesis') {
              const arr = ensureArrayBucket(aiTurn.synthesisResponses = (aiTurn.synthesisResponses || {}), providerId);
              arr.push({ providerId, text: entry.text || '', status: entry.status || 'completed', meta: entry.meta || {} });
            } else if (responseType === 'batch') {
              aiTurn.batchResponses = aiTurn.batchResponses || {};
              aiTurn.batchResponses[providerId] = { providerId, text: entry.text || '', status: entry.status || 'completed', meta: entry.meta || {} };
            }

            if (usePA) {
              // Persist provider response record
              const respId = `pr-${sessionId}-${aiTurn.id}-${providerId}-${responseType}-${idx}-${Date.now()}`;
              const record = {
                id: respId,
                sessionId,
                aiTurnId: aiTurn.id,
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
            }
          }
        }
      };

      await persistBucket(additions.batchResponses, 'batch');
      await persistBucket(additions.synthesisResponses, 'synthesis');
      await persistBucket(additions.mappingResponses, 'mapping');

      session.lastActivity = now;
      await this.saveSession(sessionId);
      return true;
    } catch (error) {
      console.error('[SessionManager] appendProviderResponses failed:', error);
      return false;
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
  }

  

  

  /**
   * Get or create a session (enhanced with persistence layer support)
   */
  async getOrCreateSession(sessionId) {
    if (!sessionId) throw new Error('sessionId required');
    return this.getOrCreateSessionWithPersistence(sessionId);
  }

  /**
   * Get or create session using new persistence layer
   */
  async getOrCreateSessionWithPersistence(sessionId) {
    try {
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
          updatedAt: Date.now()
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
      
      // Build legacy-compatible session object for backward compatibility
      const legacySession = await this.buildLegacySessionObject(sessionId);
      this.sessions[sessionId] = legacySession;
      
      return legacySession;
    } catch (error) {
      console.error(`[SessionManager] Failed to get/create session ${sessionId}:`, error);
      return null;
    }
  }


  /**
   * Build legacy-compatible session object from persistence layer
   */
  async buildLegacySessionObject(sessionId) {
    try {
      const sessionRecord = await this.adapter.get('sessions', sessionId);
      if (!sessionRecord) return null;
      
      // Get threads - using getAll and filtering by sessionId
      const allThreads = await this.adapter.getAll('threads');
      const threads = allThreads.filter(thread => thread.sessionId === sessionId);
      const threadsObj = {};
      threads.forEach(thread => {
        threadsObj[thread.id] = {
          id: thread.id,
          sessionId: thread.sessionId,
          parentThreadId: thread.parentThreadId,
          branchPointTurnId: thread.branchPointTurnId,
          name: thread.title,
          color: '#6366f1',
          isActive: thread.isActive,
          createdAt: thread.createdAt,
          lastActivity: thread.updatedAt
        };
      });
      
      // Get turns - using getAll and filtering by sessionId
      const allTurns = await this.adapter.getAll('turns');
      const turns = allTurns
        .filter(turn => turn.sessionId === sessionId)
        .sort((a, b) => (a.sequence ?? a.createdAt) - (b.sequence ?? b.createdAt));

      // Prepare a lookup for AI turn responses by aiTurnId
      const allResponses = await this.adapter.getAll('provider_responses');
      const responsesByTurn = new Map();
      for (const resp of allResponses) {
        if (resp.sessionId !== sessionId) continue;
        const key = resp.aiTurnId;
        if (!responsesByTurn.has(key)) {
          responsesByTurn.set(key, { batch: {}, synthesis: {}, mapping: {} });
        }
        const bucket = responsesByTurn.get(key);
        const entry = {
          providerId: resp.providerId,
          text: resp.text || '',
          status: resp.status || 'completed',
          meta: resp.meta || {}
        };
        if (resp.responseType === 'batch') {
          bucket.batch[resp.providerId] = entry;
        } else if (resp.responseType === 'synthesis') {
          const arr = bucket.synthesis[resp.providerId] || [];
          arr.push(entry);
          bucket.synthesis[resp.providerId] = arr;
        } else if (resp.responseType === 'mapping') {
          const arr = bucket.mapping[resp.providerId] || [];
          arr.push(entry);
          bucket.mapping[resp.providerId] = arr;
        }
      }

      const turnsArray = turns.map(turn => {
        const base = {
          id: turn.id,
          text: turn.content,
          threadId: turn.threadId,
          createdAt: turn.createdAt,
          updatedAt: turn.updatedAt
        };
        if (turn.type === 'user' || turn.role === 'user') {
          return { ...base, type: 'user' };
        } else {
          // assistant/ai turn
          const respBuckets = responsesByTurn.get(turn.id) || { batch: {}, synthesis: {}, mapping: {} };
          return {
            ...base,
            type: 'ai',
            batchResponses: respBuckets.batch,
            synthesisResponses: respBuckets.synthesis,
            mappingResponses: respBuckets.mapping,
            completedAt: turn.updatedAt
          };
        }
      });
      
      // Get provider contexts - using getAll and filtering by sessionId
      const allContexts = await this.adapter.getAll('provider_contexts');
      const contexts = allContexts.filter(context => context.sessionId === sessionId);
      const providersObj = {};
      contexts.forEach(context => {
        providersObj[context.providerId] = {
          ...context.contextData,
          lastUpdated: context.updatedAt
        };
      });
      
      return {
        sessionId: sessionRecord.id,
        providers: providersObj,
        contextHistory: [],
        createdAt: sessionRecord.createdAt,
        lastActivity: sessionRecord.updatedAt,
        title: sessionRecord.title,
        turns: turnsArray,
        threads: threadsObj
      };
    } catch (error) {
      console.error(`[SessionManager] Failed to build legacy session object for ${sessionId}:`, error);
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
      let contextRecord = contexts[0]; // Get the most recent one
      
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
   * Get provider contexts (backward compatible)
   */
  getProviderContexts(sessionId, threadId = 'default-thread') {
    const session = this.sessions[sessionId];
    if (!session) return {};
    const contexts = {};
    for (const [providerId, data] of Object.entries(session.providers || {})) {
      if (data?.meta) contexts[providerId] = { meta: data.meta };
    }
    return contexts;
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
    return this.saveTurnWithPersistence(sessionId, userTurn, aiTurn);
  }


  /**
   * Persist a complete user+AI turn and all provider responses
   */
  async saveTurnWithPersistence(sessionId, userTurn, aiTurn) {
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
          mappingResponseCount: this.countResponses(aiTurn.mappingResponses)
        };
        await this.adapter.put('turns', aiTurnRecord);

        // Mirror in legacy cache for UI compatibility
        session.turns = session.turns || [];
        session.turns.push({ ...aiTurn, threadId: 'default-thread', completedAt: now });
      }

      // Title: first user turn text if missing
      if (!session.title && userTurn?.text) {
        session.title = String(userTurn.text).slice(0, 50);
        const sessionRecord = await this.adapter.get('sessions', sessionId);
        if (sessionRecord) {
          sessionRecord.title = session.title;
          sessionRecord.updatedAt = now;
          await this.adapter.put('sessions', sessionRecord);
        }
      }

      session.lastActivity = now;
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