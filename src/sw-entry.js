// ============================================================================
// UNIFIED SERVICE WORKER ENTRY POINT
// Combines persistence layer, provider management, and message routing
// ============================================================================
// === bg: idempotent listener registration ===


// Core Infrastructure Imports

// ...rest of your service worker logic

import {
  NetRulesManager,
  CSPController,
  UserAgentController,
  ArkoseController,
  BusController,
  LifecycleManager,
  HTOSRequestLifecycleManager,
  utils,
} from "./core/vendor-exports.js";
import { WorkflowCompiler } from "./core/workflow-compiler.js";
import { ContextResolver } from "./core/context-resolver.js";
import { SWBootstrap } from "./HTOS/ServiceWorkerBootstrap.js";
import { ClaudeAdapter } from "./providers/claude-adapter.js";
import { GeminiAdapter } from "./providers/gemini-adapter.js";
import { GeminiProAdapter } from "./providers/gemini-pro-adapter.js";
import { ChatGPTAdapter } from "./providers/chatgpt-adapter.js";
import { QwenAdapter } from "./providers/qwen-adapter.js";
import { ClaudeProviderController } from "./providers/claude.js";
import { GeminiProviderController } from "./providers/gemini.js";
import { ChatGPTProviderController } from "./providers/chatgpt.js";
import { QwenProviderController } from "./providers/qwen.js";
import { DNRUtils } from "./core/dnr-utils.js";
import { ConnectionHandler } from "./core/connection-handler.js";

// Persistence Layer Imports
import { SessionManager } from './persistence/SessionManager.js';
import { initializePersistenceLayer } from './persistence/index.js';
import { errorHandler } from './utils/ErrorHandler.js';
import { persistenceMonitor } from './debug/PersistenceMonitor.js';

// ============================================================================
// FEATURE FLAGS (Source of Truth)
// ============================================================================
// ✅ CHANGED: Enable persistence by default for production use
globalThis.HTOS_USE_PERSISTENCE_ADAPTER = true;
globalThis.HTOS_ENABLE_DOCUMENT_PERSISTENCE = true;
globalThis.HTOS_ENABLE_PROVENANCE_TRACKING = false; // Optional advanced feature

const HTOS_USE_PERSISTENCE_ADAPTER = globalThis.HTOS_USE_PERSISTENCE_ADAPTER;
const HTOS_ENABLE_DOCUMENT_PERSISTENCE = globalThis.HTOS_ENABLE_DOCUMENT_PERSISTENCE;

// ============================================================================
// GLOBAL STATE MANAGEMENT
// ============================================================================
let sessionManager = null;
let persistenceLayer = null;
const __HTOS_SESSIONS = (self.__HTOS_SESSIONS = self.__HTOS_SESSIONS || {});

// Ensure fetch is correctly bound
try {
  if (typeof fetch === "function" && typeof globalThis !== "undefined") {
    globalThis.fetch = fetch.bind(globalThis);
  }
} catch (_) {}

// Initialize BusController globally
self.BusController = BusController;

// ============================================================================
// PERSISTENCE LAYER INITIALIZATION
// ============================================================================
async function initializePersistence() {
  const operationId = persistenceMonitor.startOperation('INITIALIZE_PERSISTENCE', {
    useAdapter: true,
    enableDocumentPersistence: HTOS_ENABLE_DOCUMENT_PERSISTENCE
  });
  
  try {
    persistenceLayer = await initializePersistenceLayer({
      dbName: 'HTOSPersistenceDB',
      version: 1,
      enableMigration: true,
      enableProvenance: globalThis.HTOS_ENABLE_PROVENANCE_TRACKING || false
    });
    // Expose globally for UI bridge and debugging
    self.__HTOS_PERSISTENCE_LAYER = persistenceLayer;
    
    persistenceMonitor.recordConnection('HTOSPersistenceDB', 1, [
      'sessions', 'threads', 'turns', 'provider_responses', 
      'documents', 'canvas_blocks', 'ghosts', 'provider_contexts', 'metadata'
    ]);
    
    console.log('[SW] ✅ Persistence layer initialized');
    console.warn('persistence adapter initialized');
    persistenceMonitor.endOperation(operationId, { success: true });
    return persistenceLayer;
  } catch (error) {
    persistenceMonitor.endOperation(operationId, null, error);
    const handledError = await errorHandler.handleError(error, {
      operation: 'initializePersistence',
      context: { useAdapter: true }
    });
    console.error('[SW] ❌ Failed to initialize persistence layer:', handledError);
    // Do NOT fallback silently; propagate error to fail initialization
    throw handledError;
  }
}

// ============================================================================
// SESSION MANAGER INITIALIZATION
// ============================================================================
async function initializeSessionManager(persistenceLayer) {
  // ✅ ALWAYS reinitialize if adapter is not ready (indicates stale instance)
  if (sessionManager && sessionManager.adapter?.isReady()) {
    console.log("[SW] Reusing existing SessionManager instance");
    return sessionManager;
  }

  // If we have a stale instance, clear it
  if (sessionManager) {
    console.warn("[SW] Clearing stale SessionManager instance");
    sessionManager = null;
  }

  try {
    console.log("[SW:INIT:5] Initializing session manager...");
    sessionManager = new SessionManager();

    // ✅ CRITICAL: Ensure sessions reference is fresh
    sessionManager.sessions = __HTOS_SESSIONS;

    // Always initialize with persistence adapter
    const { SimpleIndexedDBAdapter } = await import(
      "./persistence/SimpleIndexedDBAdapter.js"
    );
    const simpleAdapter = new SimpleIndexedDBAdapter();

    console.log(
      "[SW] Initializing SimpleIndexedDBAdapter for SessionManager..."
    );
    await simpleAdapter.init();

    await sessionManager.initialize({
      adapter: simpleAdapter,
    });

    console.log("[SW:INIT:6] ✅ Session manager initialized with persistence");

    return sessionManager;
  } catch (error) {
    console.error("[SW] ❌ Failed to initialize session manager:", error);
    throw error;
  }
}


// ============================================================================
// PERSISTENT OFFSCREEN DOCUMENT CONTROLLER
// ============================================================================
const OffscreenController = {
  _initialized: false,
  async init() {
    if (this._initialized) return;
    console.log('[SW] Initializing persistent offscreen document controller...');
    await this._createOffscreenPageIfMissing();
    if (!self.BusController) {
      self.BusController = BusController;
      await self.BusController.init();
    }
    this._initialized = true;
  },
  async _createOffscreenPageIfMissing() {
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.BLOBS, chrome.offscreen.Reason.DOM_PARSER],
        justification: 'HTOS needs persistent offscreen DOM for complex operations and a stable message bus.',
      });
    }
  }
};

// ============================================================================
// PROVIDER ADAPTER REGISTRY
// ============================================================================
class ProviderRegistry {
  constructor() {
    this.adapters = new Map();
    this.controllers = new Map();
  }
  register(providerId, controller, adapter) {
    this.controllers.set(providerId, controller);
    this.adapters.set(providerId, adapter);
  }
  getAdapter(providerId) { return this.adapters.get(String(providerId).toLowerCase()); }
  getController(providerId) { return this.controllers.get(String(providerId).toLowerCase()); }
  listProviders() { return Array.from(this.adapters.keys()); }
  isAvailable(providerId) { return this.adapters.has(String(providerId).toLowerCase()); }
}
const providerRegistry = new ProviderRegistry();
self.providerRegistry = providerRegistry;

// ============================================================================
// FAULT-TOLERANT ORCHESTRATOR WRAPPER
// ============================================================================
class FaultTolerantOrchestrator {
  constructor() {
    this.activeRequests = new Map();
    this.lifecycleManager = self.lifecycleManager;
  }

  async executeParallelFanout(prompt, providers, options = {}) {
    const {
      sessionId = `req-${Date.now()}`,
      onPartial = () => {},
      onAllComplete = () => {},
      useThinking = false,
      providerContexts = {},
      providerMeta = {}
    } = options;

    if (this.lifecycleManager) this.lifecycleManager.keepalive(true);

    const results = new Map();
    const errors = new Map();
    const abortControllers = new Map();
    this.activeRequests.set(sessionId, { abortControllers });

    const providerPromises = providers.map(providerId => {
      // This IIFE returns a promise that *always resolves*
      return (async () => {
        const abortController = new AbortController();
        abortControllers.set(providerId, abortController);
        
        const adapter = providerRegistry.getAdapter(providerId);
        if (!adapter) {
          return {
            providerId,
            status: 'rejected',
            reason: new Error(`Provider ${providerId} not available`)
          };
        }

        let aggregatedText = ""; // Buffer for this provider's partials

        // If we have a provider-specific context, attempt a continuation.
        // Each adapter's sendContinuation will gracefully fall back to sendPrompt
        // when its required identifiers (e.g., conversationId/chatId/cursor) are missing.

        const request = {
          originalPrompt: prompt,
          sessionId,
          meta: {
            ...(providerContexts[providerId]?.meta || {}),
            ...(providerMeta?.[providerId] || {}),
            useThinking
          }
        };

        try {
          // Favor "send prompt with context" as the single path for both new and continued chats.
          // When context exists, it's already merged into request.meta above.
          const result = await adapter.sendPrompt(
            request,
            (chunk) => {
              const textChunk = typeof chunk === 'string' ? chunk : chunk.text;
              if (textChunk) aggregatedText += textChunk;
              onPartial(providerId, typeof chunk === 'string' ? { text: chunk } : chunk);
            },
            abortController.signal
          );
          
          if (!result.text && aggregatedText) {
            result.text = aggregatedText;
          }
          
          return { providerId, status: 'fulfilled', value: result };

        } catch (error) {
          if (aggregatedText) {
            return {
              providerId,
              status: 'fulfilled',
              value: {
                text: aggregatedText,
                meta: {},
                softError: {
                  name: error.name,
                  message: error.message
                }
              }
            };
          }
          return { providerId, status: 'rejected', reason: error };
        }
      })(); // End of IIFE
    });

    Promise.all(providerPromises).then((settledResults) => {
      settledResults.forEach(item => {
        if (item.status === 'fulfilled') {
          results.set(item.providerId, item.value);
        } else {
          errors.set(item.providerId, item.reason);
        }
      });
      
      onAllComplete(results, errors);
      
      this.activeRequests.delete(sessionId);
      if (this.lifecycleManager) this.lifecycleManager.keepalive(false);
    });
  }

  _abortRequest(sessionId) {
    const request = this.activeRequests.get(sessionId);
    if (request) {
      request.abortControllers.forEach(controller => controller.abort());
      this.activeRequests.delete(sessionId);
      if (this.lifecycleManager) this.lifecycleManager.keepalive(false);
    }
  }
}

// ============================================================================
// GLOBAL INFRASTRUCTURE INITIALIZATION
// ============================================================================
async function initializeGlobalInfrastructure() {
  console.log("[SW] Initializing global infrastructure...");
  try {
    await NetRulesManager.init();
    CSPController.init();
    await UserAgentController.init();
    await ArkoseController.init();
    await DNRUtils.initialize();
    await OffscreenController.init();
    await BusController.init();
    self.bus = BusController;
    console.log("[SW] Global infrastructure initialization complete.");
  } catch (e) {
    console.error("[SW] Core infrastructure init failed", e);
  }
}

// ============================================================================
// PROVIDER INITIALIZATION
// ============================================================================
async function initializeProviders() {
  console.log("[SW] Initializing providers...");
  const providerConfigs = [
    { name: 'claude', Controller: ClaudeProviderController, Adapter: ClaudeAdapter },
    { name: 'gemini', Controller: GeminiProviderController, Adapter: GeminiAdapter },
    { name: 'gemini-pro', Controller: GeminiProviderController, Adapter: GeminiProAdapter },
    { name: 'chatgpt', Controller: ChatGPTProviderController, Adapter: ChatGPTAdapter },
    { name: 'qwen', Controller: QwenProviderController, Adapter: QwenAdapter },
  ];
  for (const config of providerConfigs) {
    try {
      const controller = new config.Controller();
      if (typeof controller.init === 'function') await controller.init();
      const adapter = new config.Adapter(controller);
      if (typeof adapter.init === 'function') await adapter.init();
      providerRegistry.register(config.name, controller, adapter);
      console.log(`[SW] ✓ ${config.name} initialized`);
    } catch (e) {
      console.error(`[SW] Failed to initialize ${config.name}:`, e);
    }
  }
  return providerRegistry.listProviders();
}

// ============================================================================
// ORCHESTRATOR INITIALIZATION
// ============================================================================
async function initializeOrchestrator() {
  try {
    self.lifecycleManager = new LifecycleManager();
    self.faultTolerantOrchestrator = new FaultTolerantOrchestrator();
    console.log("[SW] ✓ FaultTolerantOrchestrator initialized");
  } catch (e) {
    console.error("[SW] Orchestrator init failed", e);
  }
}

// ============================================================================
// GLOBAL SERVICES (single-shot initialization)
// ============================================================================
let globalServicesReady = null;

async function initializeGlobalServices() {
  if (globalServicesReady) return globalServicesReady;

  globalServicesReady = (async () => {
    console.log("[SW] 🚀 Initializing global services...");
    
    // 1. Initialize persistence layer FIRST
    const pl = await initializePersistence();
    // Expose persistence layer globally for runtime checks
    persistenceLayer = pl;
    self.__HTOS_PERSISTENCE_LAYER = pl;
    
    // 2. Initialize session manager (depends on persistence)
    const sessionManager = await initializeSessionManager(pl);
    
    // 3. Initialize infrastructure
    await initializeGlobalInfrastructure();
    
    // 4. Initialize providers
    await initializeProviders();
    
    // 5. Initialize orchestrator
    await initializeOrchestrator();
    
    // 6. Create compiler and context resolver
    const compiler = new WorkflowCompiler(sessionManager);
    const contextResolver = new ContextResolver(sessionManager);
    
    console.log("[SW] ✅ Global services ready");
    return {
      orchestrator: self.faultTolerantOrchestrator,
      sessionManager: sessionManager,
      compiler,
      contextResolver,
      persistenceLayer: pl, // Expose persistence layer to other modules
    };
  })();

  return globalServicesReady;
}

// ============================================================================
// UNIFIED MESSAGE HANDLER
// Handles history operations and persistence-backed actions
// ============================================================================
async function handleUnifiedMessage(message, sender, sendResponse) {
  try {
    const sm = sessionManager || await initializeSessionManager();
    if (!sm) {
      sendResponse({ success: false, error: 'Service not ready' });
      return true;
    }
    
    switch (message.type) {
      // ========================================================================
      // HISTORY OPERATIONS
      // ========================================================================
      case 'GET_FULL_HISTORY': {
        // Always use persistence layer for history
        let sessions = [];
        try {
          // 1. Attempt to load from the new, normalized persistence layer first.
          const allSessions = await sm.adapter.getAll('sessions');
          if (allSessions && allSessions.length > 0) {
            sessions = allSessions.map(r => ({
            id: r.id,
            sessionId: r.id,
            title: r.title || 'New Chat',
            startTime: r.createdAt,
            lastActivity: r.updatedAt || r.lastActivity,
            messageCount: r.turnCount || 0,
            firstMessage: ''
          })).sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
          } else {
            // 2. FALLBACK: If new layer is empty, read from the old monolith storage.
            console.warn('[SW] No sessions in new persistence layer, attempting fallback to legacy chrome.storage...');
            const legacyData = await chrome.storage.local.get(['htos_sessions']);
            const legacySessions = legacyData?.htos_sessions || {};
            sessions = Object.values(legacySessions).map((s) => ({
              id: s.sessionId,
              sessionId: s.sessionId,
              title: s.title || 'Legacy Chat',
              startTime: s.createdAt || 0,
              lastActivity: s.lastActivity || 0,
              messageCount: s.turns?.length || 0,
            })).sort((a, b) => b.lastActivity - a.lastActivity);
          }
        } catch (e) {
          console.error('[SW] Failed to build full history from persistence:', e);
          sessions = [];
        }
        sendResponse({ success: true, data: { sessions } });
        return true;
      }
      
      case 'GET_HISTORY_SESSION': {
        try {
          const sessionId = message.sessionId || message.payload?.sessionId;
          if (!sessionId) {
            console.error('[SW] GET_HISTORY_SESSION missing sessionId in message:', message);
            sendResponse({ success: false, error: 'Missing sessionId' });
            return true;
          }

          let session = sm.sessions?.[sessionId];
          if (!session && sm.getPersistenceStatus?.().usePersistenceAdapter && sm.adapter?.isReady()) {
            // Hydrate from persistence
            session = await sm.buildLegacySessionObject(sessionId);
            if (session) {
              sm.sessions[sessionId] = session;
            }
          }

          if (session) {
            // Build "rounds" the UI expects: { createdAt, userTurnId, aiTurnId, user: {id?, text, createdAt}, providers: {...}, completedAt }
            const turns = Array.isArray(session.turns) ? session.turns : [];
            const rounds = [];
            for (let i = 0; i < turns.length; i++) {
              const t = turns[i];
              if (t && t.type === 'user') {
                const u = t;
                const ai = turns[i + 1] && turns[i + 1].type === 'ai' ? turns[i + 1] : null;
                const providers = (ai && (ai.batchResponses || ai.providerResponses)) ? (ai.batchResponses || ai.providerResponses) : {};
                rounds.push({
                  createdAt: Number(u.createdAt || Date.now()),
                  userTurnId: String(u.id || ''),
                  aiTurnId: String((ai && ai.id) || ''),
                  user: {
                    id: String(u.id || ''),
                    text: String(u.text || ''),
                    createdAt: Number(u.createdAt || Date.now())
                  },
                  providers,
                  synthesisResponses: ai?.synthesisResponses || {},
                  mappingResponses: ai?.mappingResponses || {},
                  completedAt: Number((ai && ai.createdAt) || (u.createdAt ? (Number(u.createdAt) + 1) : Date.now()))
                });
              }
            }

            const transformed = {
              id: session.sessionId,
              sessionId: session.sessionId,
              title: session.title,
              createdAt: session.createdAt,
              lastActivity: session.lastActivity,
              turns: rounds,
              providerContexts: session.providers || {}
            };
            sendResponse({ success: true, data: transformed });
          } else {
            sendResponse({ success: false, error: 'Session not found' });
          }
        } catch (e) {
          console.error('[SW] GET_HISTORY_SESSION error:', e);
          sendResponse({ success: false, error: 'Failed to load session' });
        }
        return true;
      }
      
      case 'GET_SYSTEM_STATUS': {
        const layer = self.__HTOS_PERSISTENCE_LAYER || persistenceLayer;
        const ps = sm.getPersistenceStatus?.() || {};
        sendResponse({ 
          success: true, 
          data: { 
            availableProviders: providerRegistry.listProviders(),
            persistenceEnabled: true,
            documentsEnabled: HTOS_ENABLE_DOCUMENT_PERSISTENCE,
            sessionManagerType: sm?.constructor?.name || 'unknown',
            persistenceLayerAvailable: !!layer,
            usePersistenceAdapter: !!ps.usePersistenceAdapter,
            adapterReady: !!ps.adapterReady,
            activeMode: 'indexeddb'
          }
        });
        return true;
      }
      
      // GET_HEALTH_STATUS is handled in the message listener for immediate response
      
      // ========================================================================
      // PERSISTENCE OPERATIONS (Enhanced functionality)
      // ========================================================================
      case 'GET_SESSION': {
        const operationId = persistenceMonitor.startOperation('GET_SESSION', {
          sessionId: message.sessionId || message.payload?.sessionId
        });

        try {
          const sessionId = message.sessionId || message.payload?.sessionId;
          const session = await sm.getOrCreateSession(sessionId);
          persistenceMonitor.endOperation(operationId, { sessionFound: !!session });
          sendResponse({ success: true, session });
        } catch (error) {
          persistenceMonitor.endOperation(operationId, null, error);
          const handledError = await errorHandler.handleError(error, {
            operation: 'getSession',
            sessionId: message.sessionId || message.payload?.sessionId,
            retry: () => sm.getOrCreateSession(message.sessionId || message.payload?.sessionId)
          });
          sendResponse({ success: false, error: handledError.message });
        }
        return true;
      }
        
      case 'SAVE_TURN': {
        const sessionId = message.sessionId || message.payload?.sessionId;
        await sm.addTurn(sessionId, message.turn);
        sendResponse({ success: true });
        return true;
      }
        
      case 'UPDATE_PROVIDER_CONTEXT': {
        const sessionId = message.sessionId || message.payload?.sessionId;
        await sm.updateProviderContext(
          sessionId,
          message.providerId || message.payload?.providerId,
          message.context || message.payload?.context
        );
        sendResponse({ success: true });
        return true;
      }
        
      case 'CREATE_THREAD': {
        const sessionId = message.sessionId || message.payload?.sessionId;
        const thread = await sm.createThread(
          sessionId,
          message.title || message.payload?.title,
          message.sourceAiTurnId || message.payload?.sourceAiTurnId
        );
        sendResponse({ success: true, thread });
        return true;
      }
        
      case 'SWITCH_THREAD': {
        const sessionId = message.sessionId || message.payload?.sessionId;
        await sm.switchThread(sessionId, message.threadId || message.payload?.threadId);
        sendResponse({ success: true });
        return true;
      }
        
      case 'DELETE_SESSION': {
        const sessionId = message.sessionId || message.payload?.sessionId;
        await sm.deleteSession(sessionId);
        sendResponse({ success: true });
        return true;
      }
        
      case 'GET_PERSISTENCE_STATUS': {
        const layer = self.__HTOS_PERSISTENCE_LAYER || persistenceLayer;
        const status = {
          persistenceEnabled: HTOS_USE_PERSISTENCE_ADAPTER,
          documentPersistenceEnabled: HTOS_ENABLE_DOCUMENT_PERSISTENCE,
          sessionManagerType: sm?.constructor?.name || 'unknown',
          persistenceLayerAvailable: !!layer,
          adapterStatus: sm?.getPersistenceStatus ? sm.getPersistenceStatus() : null
        };
        sendResponse({ success: true, status });
        return true;
      }
        

        
      // ========================================================================
      // DOCUMENT OPERATIONS (When document persistence is enabled)
      // ========================================================================
      case 'SAVE_DOCUMENT': {
        const layer = self.__HTOS_PERSISTENCE_LAYER || persistenceLayer;
        if (HTOS_ENABLE_DOCUMENT_PERSISTENCE && layer && layer.documentManager) {
          try {
            await layer.documentManager.saveDocument(
              message.documentId,
              message.document,
              message.content
            );
          } catch (e) {
            // If document doesn't exist yet, create it (upsert) and retry save
            const msg = (e && e.message) ? e.message : String(e);
            if (msg && msg.toLowerCase().includes('not found')) {
              try {
                const now = Date.now();
                const baseDoc = {
                  id: message.documentId,
                  title: (message.document && message.document.title) || 'Untitled Document',
                  sourceSessionId: message.document?.sourceSessionId,
                  canvasContent: Array.isArray(message.content) ? message.content : (message.document?.canvasContent || []),
                  // Persist canvas tabs state when upserting a new document
                  canvasTabs: Array.isArray(message.document?.canvasTabs) ? message.document.canvasTabs : [],
                  activeTabId: message.document?.activeTabId || (Array.isArray(message.document?.canvasTabs) ? message.document.canvasTabs[0]?.id : undefined),
                  granularity: message.document?.granularity || 'paragraph',
                  isDirty: false,
                  createdAt: message.document?.createdAt || now,
                  updatedAt: now,
                  lastModified: now,
                  version: message.document?.version || 1,
                  blockCount: Array.isArray(message.content) ? message.content.length : (message.document?.blockCount || 0),
                  refinementHistory: message.document?.refinementHistory || [],
                  exportHistory: message.document?.exportHistory || [],
                  snapshots: message.document?.snapshots || [],
                };
                await layer.adapter.put('documents', baseDoc);
                // Retry save to let the manager decompose and update derived fields
                await layer.documentManager.saveDocument(
                  message.documentId,
                  message.document,
                  message.content
                );
              } catch (inner) {
                console.error('[SW] SAVE_DOCUMENT upsert failed:', inner);
                sendResponse({ success: false, error: inner?.message || String(inner) });
                return true;
              }
            } else {
              console.error('[SW] SAVE_DOCUMENT failed:', e);
              sendResponse({ success: false, error: msg });
              return true;
            }
          }
          sendResponse({ success: true });
        } else {
          const reason = !HTOS_ENABLE_DOCUMENT_PERSISTENCE
            ? 'HTOS_ENABLE_DOCUMENT_PERSISTENCE is false'
            : 'Persistence layer unavailable';
          console.warn('[SW] SAVE_DOCUMENT skipped:', reason);
          sendResponse({ success: false, error: `Document persistence not enabled: ${reason}` });
        }
        return true;
      }
        
      case 'LOAD_DOCUMENT': {
        const layer = self.__HTOS_PERSISTENCE_LAYER || persistenceLayer;
        if (HTOS_ENABLE_DOCUMENT_PERSISTENCE && layer && layer.documentManager) {
          const document = await layer.documentManager.loadDocument(
            message.documentId,
            message.reconstructContent
          );
          sendResponse({ success: true, document });
        } else {
          const reason = !HTOS_ENABLE_DOCUMENT_PERSISTENCE
            ? 'HTOS_ENABLE_DOCUMENT_PERSISTENCE is false'
            : 'Persistence layer unavailable';
          console.warn('[SW] LOAD_DOCUMENT skipped:', reason);
          sendResponse({ success: false, error: `Document persistence not enabled: ${reason}` });
        }
        return true;
      }
        
      case 'CREATE_GHOST': {
        const layer = self.__HTOS_PERSISTENCE_LAYER || persistenceLayer;
        if (HTOS_ENABLE_DOCUMENT_PERSISTENCE && layer && layer.documentManager) {
          const ghost = await layer.documentManager.createGhost(
            message.documentId,
            message.text,
            message.provenance
          );
          sendResponse({ success: true, ghost });
        } else {
          const reason = !HTOS_ENABLE_DOCUMENT_PERSISTENCE
            ? 'HTOS_ENABLE_DOCUMENT_PERSISTENCE is false'
            : 'Persistence layer unavailable';
          console.warn('[SW] CREATE_GHOST skipped:', reason);
          sendResponse({ success: false, error: `Document persistence not enabled: ${reason}` });
        }
        return true;
      }

      case 'GET_DOCUMENT_GHOSTS': {
        const layer = self.__HTOS_PERSISTENCE_LAYER || persistenceLayer;
        if (HTOS_ENABLE_DOCUMENT_PERSISTENCE && layer && (layer.documentManager || layer.adapter)) {
          try {
            let ghosts = [];
            // Prefer documentManager API if available
            if (layer.documentManager && typeof layer.documentManager.getDocumentGhosts === 'function') {
              ghosts = await layer.documentManager.getDocumentGhosts(message.documentId);
            } else if (layer.adapter && typeof layer.adapter.getAll === 'function') {
              const allGhosts = await layer.adapter.getAll('ghosts');
              ghosts = (allGhosts || []).filter(g => g.documentId === message.documentId);
            } else {
              throw new Error('No ghost retrieval API available on persistence layer');
            }
            sendResponse({ success: true, ghosts });
          } catch (err) {
            console.error('[SW] GET_DOCUMENT_GHOSTS failed:', err);
            sendResponse({ success: false, error: err?.message || String(err) });
          }
        } else {
          sendResponse({ success: false, error: 'Document persistence not enabled' });
        }
        return true;
      }

      case 'DELETE_GHOST': {
        const layer = self.__HTOS_PERSISTENCE_LAYER || persistenceLayer;
        if (HTOS_ENABLE_DOCUMENT_PERSISTENCE && layer && (layer.documentManager || layer.adapter)) {
          try {
            if (layer.documentManager && typeof layer.documentManager.deleteGhost === 'function') {
              await layer.documentManager.deleteGhost(message.ghostId);
            } else if (layer.adapter) {
              // Try a few common adapter delete method names
              if (typeof layer.adapter.delete === 'function') {
                await layer.adapter.delete('ghosts', message.ghostId);
              } else if (typeof layer.adapter.remove === 'function') {
                await layer.adapter.remove('ghosts', message.ghostId);
              } else if (typeof layer.adapter.deleteRecord === 'function') {
                await layer.adapter.deleteRecord('ghosts', message.ghostId);
              } else {
                throw new Error('Adapter does not expose a delete method for ghosts');
              }
            } else {
              throw new Error('No persistence API available to delete ghost');
            }
            sendResponse({ success: true });
          } catch (err) {
            console.error('[SW] DELETE_GHOST failed:', err);
            sendResponse({ success: false, error: err?.message || String(err) });
          }
        } else {
          sendResponse({ success: false, error: 'Document persistence not enabled' });
        }
        return true;
      }
      
      case 'DELETE_DOCUMENT': {
        const layer = self.__HTOS_PERSISTENCE_LAYER || persistenceLayer;
        if (HTOS_ENABLE_DOCUMENT_PERSISTENCE && layer && layer.documentManager) {
          await layer.documentManager.deleteDocument(message.documentId);
          sendResponse({ success: true });
        } else {
          const reason = !HTOS_ENABLE_DOCUMENT_PERSISTENCE
            ? 'HTOS_ENABLE_DOCUMENT_PERSISTENCE is false'
            : 'Persistence layer unavailable';
          console.warn('[SW] DELETE_DOCUMENT skipped:', reason);
          sendResponse({ success: false, error: `Document persistence not enabled: ${reason}` });
        }
        return true;
      }

      case 'LIST_DOCUMENTS': {
        const layer = self.__HTOS_PERSISTENCE_LAYER || persistenceLayer;
        if (HTOS_ENABLE_DOCUMENT_PERSISTENCE && layer && layer.adapter) {
          try {
            // Prefer adapter listing for summaries
            const docs = await layer.adapter.listDocuments();
            const summaries = (docs || []).map(d => ({ 
              id: d.id, 
              title: d.title, 
              lastModified: d.lastModified ?? d.updatedAt ?? d.createdAt 
            }));
            sendResponse({ success: true, documents: summaries });
          } catch (e) {
            console.error('[SW] LIST_DOCUMENTS error:', e);
            sendResponse({ success: false, error: e?.message || String(e) });
          }
        } else {
          const reason = !HTOS_ENABLE_DOCUMENT_PERSISTENCE
            ? 'HTOS_ENABLE_DOCUMENT_PERSISTENCE is false'
            : 'Persistence layer unavailable';
          console.warn('[SW] LIST_DOCUMENTS skipped:', reason);
          sendResponse({ success: false, error: `Document persistence not enabled: ${reason}` });
        }
        return true;
      }
        
      default:
        // Unknown message type - don't handle it
        return false;
    }
  } catch (error) {
    console.error('[SW] Message handler error:', error);
    sendResponse({ success: false, error: error.message });
    return true;
  }
}

// ============================================================================
// MESSAGE LISTENER REGISTRATION
// ============================================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Ignore bus messages
  if (request?.$bus) return false;

  // Best-effort: record activity for lifecycle manager on any incoming non-bus message.
  try {
    if (self.lifecycleManager && typeof self.lifecycleManager.recordActivity === 'function') {
      self.lifecycleManager.recordActivity();
    }
  } catch (e) {
    // Swallow errors here; this is best-effort and should not interrupt message handling
  }

  // Lightweight activity ping - handled locally to quickly mark service worker as active
  if (request?.type === 'htos.activity') {
    try {
      if (self.lifecycleManager && typeof self.lifecycleManager.recordActivity === 'function') {
        self.lifecycleManager.recordActivity();
      }
    } catch (e) { }
    sendResponse({ success: true });
    return true;
  }

  // Immediate health status response (no async init await)
  if (request?.type === 'GET_HEALTH_STATUS') {
    try {
      const status = getHealthStatus();
      sendResponse({ success: true, status });
    } catch (e) {
      sendResponse({ success: false, error: e?.message || String(e)});
    }
    return true; // Explicitly keep channel open for async-style patterns
  }

  // Handle all other messages through unified handler
  if (request?.type) {
    handleUnifiedMessage(request, sender, sendResponse);
    return true; // Always return true to keep channel open for async responses
  }
  
  return false;
});

// ============================================================================
// PORT CONNECTIONS -> ConnectionHandler per port
// ============================================================================
chrome.runtime.onConnect.addListener(async (port) => {
  if (port.name !== "htos-popup") return;

  // Record activity on port connections so lifecycle manager can start a heartbeat
  try {
    if (self.lifecycleManager && typeof self.lifecycleManager.recordActivity === 'function') {
      self.lifecycleManager.recordActivity();
    }
  } catch (e) { }

  console.log("[SW] New connection received, initializing handler...");

  try {
    const services = await initializeGlobalServices();
    const handler = new ConnectionHandler(port, services);
    await handler.init();
    console.log("[SW] Connection handler ready");
  } catch (error) {
    console.error("[SW] Failed to initialize connection handler:", error);
    try {
      port.postMessage({ type: 'INITIALIZATION_FAILED', error: error.message });
    } catch (_) {}
  }
});

// ============================================================================
// EXTENSION ACTION HANDLER
// ============================================================================
chrome.action?.onClicked.addListener(async () => {
  try {
    const url = chrome.runtime.getURL("ui/index.html");
    const [existingTab] = await chrome.tabs.query({ url });
    if (existingTab?.id) {
      await chrome.tabs.update(existingTab.id, { active: true });
      if (existingTab.windowId) await chrome.windows.update(existingTab.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url });
    }
  } catch (e) {
    console.error("[SW] Failed to open UI tab:", e);
  }
});

// ============================================================================
// INSTALL/UPDATE HANDLERS
// ============================================================================
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[SW] Extension installed/updated:', details.reason);
  
  // Session migration disabled
});

// ============================================================================
// PERIODIC MAINTENANCE (started post-init)
// ============================================================================
let __cleanupTimer = null;

// ============================================================================
// LIFECYCLE HANDLERS
// ============================================================================
chrome.runtime.onStartup.addListener(() => {
  console.log('[SW] Browser startup detected');
});

chrome.runtime.onSuspend.addListener(() => {
  console.log('[SW] Service worker suspending');
});

chrome.runtime.onSuspendCanceled.addListener(() => {
  console.log('[SW] Service worker suspend canceled');
});

// ============================================================================
// HEALTH CHECK & DEBUGGING
// ============================================================================
function getHealthStatus() {
  const sm = sessionManager;
  const layer = self.__HTOS_PERSISTENCE_LAYER || persistenceLayer;
  let providers = [];
  try { providers = providerRegistry.listProviders(); } catch (_) {}
  
  return {
    timestamp: Date.now(),
    serviceWorker: 'active',
    sessionManager: sm ? (sm.isInitialized ? 'initialized' : 'initializing') : 'missing',
    persistenceLayer: layer ? 'active' : 'disabled',
    featureFlags: {
      persistenceAdapter: HTOS_USE_PERSISTENCE_ADAPTER,
      documentPersistence: HTOS_ENABLE_DOCUMENT_PERSISTENCE
    },
    providers,
    details: {
      sessionManagerType: sm?.constructor?.name || 'unknown',
      usePersistenceAdapter: sm?.usePersistenceAdapter ?? false,
      persistenceLayerAvailable: !!layer,
      initState: self.__HTOS_INIT_STATE || null
    }
  };
}

// Export for testing and debugging
globalThis.__HTOS_SW = {
  getHealthStatus,
  getSessionManager: () => sessionManager,
  getPersistenceLayer: () => persistenceLayer,
  getProviderRegistry: () => providerRegistry,
  reinitialize: initializeGlobalServices,
  runTests: async () => {
    try {
      const { PersistenceIntegrationTest } = await import('./test-persistence-integration.js');
      const tester = new PersistenceIntegrationTest();
      return await tester.runAllTests();
    } catch (error) {
      console.error('Failed to run persistence tests:', error);
      throw error;
    }
  }
};

// ============================================================================
// MAIN INITIALIZATION SEQUENCE
// ============================================================================
(async () => {
  try {
    const INIT_TIMEOUT_MS = 30000; // 30s timeout for global initialization
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('[SW:INIT] Initialization timed out after 30s')), INIT_TIMEOUT_MS);
    });
    const services = await Promise.race([initializeGlobalServices(), timeoutPromise]);
    SWBootstrap.init(services);
    console.log("[SW] 🚀 Bootstrap complete. System ready.");
    
    // Log health status
    const health = await getHealthStatus();
    console.log("[SW] Health Status:", health);

    // Track init state
    self.__HTOS_INIT_STATE = {
      initializedAt: Date.now(),
      persistenceEnabled: HTOS_USE_PERSISTENCE_ADAPTER,
      documentPersistenceEnabled: HTOS_ENABLE_DOCUMENT_PERSISTENCE,
      persistenceReady: !!services.persistenceLayer,
      providers: services?.orchestrator ? providerRegistry.listProviders() : []
    };

    // Start periodic cleanup only after init
    if (!__cleanupTimer) {
      __cleanupTimer = setInterval(async () => {
        try {
          const pl = self.__HTOS_PERSISTENCE_LAYER || services.persistenceLayer;
          if (!pl?.repositories) {
            console.warn('[SW] Cleanup skipped - persistence layer not ready');
            return;
          }
          console.log('[SW] Running periodic data cleanup...');
          const repos = pl.repositories;
          // Guard each cleanup with try/catch to avoid NotFoundError crash
          let sessionsCleaned = 0;
          let contextsCleaned = 0;
          try { sessionsCleaned = await repos.sessions.cleanupOldSessions(30); } catch (e) { console.warn('[SW] Sessions cleanup skipped:', e?.message || e); }
          try { contextsCleaned = await repos.providerContexts.cleanupOldContexts(30); } catch (e) { console.warn('[SW] Provider contexts cleanup skipped:', e?.message || e); }
          console.log(`[SW] Cleanup complete. Removed ${sessionsCleaned} old sessions and ${contextsCleaned} old contexts.`);
        } catch (error) {
          console.error('[SW] Cleanup error:', error);
        }
      }, 60000 * 30); // 30 minutes
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('Initialization timed out')) {
      console.error('[SW:INIT] Timeout occurred. Current init state:', self.__HTOS_INIT_STATE);
    }
    console.error("[SW] Bootstrap failed:", e);
  }
})();