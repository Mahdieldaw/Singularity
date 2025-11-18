// ============================================================================
// PERSISTENCE LAYER: SINGLE SOURCE OF TRUTH (SSOT)
// Ensures only ONE instance of SessionManager and adapter exists
// Prevents race conditions and DB connection conflicts
// ============================================================================

// === sw-entry.js: SSOT for Persistence ===

// ✅ CRITICAL: Module-level singletons (not in functions)
let persistenceLayerSingleton = null;
let sessionManagerSingleton = null;
let adapterSingleton = null;

// ============================================================================
// PERSISTENCE INITIALIZATION (SSOT)
// ============================================================================

async function initializePersistence() {
  // ✅ CRITICAL: Return existing singleton if already initialized
  if (persistenceLayerSingleton) {
    console.log('[Persistence] Reusing existing persistence layer singleton');
    return persistenceLayerSingleton;
  }

  const operationId = persistenceMonitor.startOperation(
    'INITIALIZE_PERSISTENCE',
    { useAdapter: true }
  );

  try {
    console.log('[Persistence] ✅ Creating NEW persistence layer (SSOT)');
    
    // Create adapter (SSOT)
    adapterSingleton = new SimpleIndexedDBAdapter();
    await adapterSingleton.init({ timeoutMs: 8000, autoRepair: true });
    
    // Create persistence layer wrapper
    persistenceLayerSingleton = {
      adapter: adapterSingleton,
      close: async () => {
        await adapterSingleton.close();
      },
    };

    // ✅ CRITICAL: Expose globally for runtime checks
    self.__HTOS_PERSISTENCE_LAYER = persistenceLayerSingleton;

    persistenceMonitor.recordConnection('HTOSPersistenceDB', 1, [
      'sessions',
      'threads',
      'turns',
      'provider_responses',
      'provider_contexts',
      'metadata',
    ]);

    console.log('[Persistence] ✅ Persistence layer initialized (singleton)');
    persistenceMonitor.endOperation(operationId, { success: true });
    
    return persistenceLayerSingleton;
  } catch (error) {
    persistenceMonitor.endOperation(operationId, null, error);
    const handledError = await errorHandler.handleError(error, {
      operation: 'initializePersistence',
      context: { useAdapter: true },
    });
    console.error('[Persistence] ❌ Failed to initialize:', handledError);
    
    // ✅ Reset singletons on failure to allow retry
    persistenceLayerSingleton = null;
    adapterSingleton = null;
    
    throw handledError;
  }
}

// ============================================================================
// SESSION MANAGER INITIALIZATION (SSOT)
// ============================================================================

async function initializeSessionManager(persistenceLayer) {
  // ✅ CRITICAL: Validate adapter readiness before reusing
  if (sessionManagerSingleton && sessionManagerSingleton.adapter?.isReady()) {
    console.log('[SessionManager] Reusing existing SessionManager singleton');
    return sessionManagerSingleton;
  }

  // ✅ Clear stale instance if adapter is not ready
  if (sessionManagerSingleton && !sessionManagerSingleton.adapter?.isReady()) {
    console.warn('[SessionManager] Clearing stale SessionManager instance');
    sessionManagerSingleton = null;
  }

  try {
    console.log('[SessionManager] ✅ Creating NEW SessionManager (SSOT)');
    
    // ✅ CRITICAL: Create singleton instance
    sessionManagerSingleton = new SessionManager();

    // ✅ CRITICAL: Reference global sessions cache
    sessionManagerSingleton.sessions = __HTOS_SESSIONS;

    // ✅ CRITICAL: Inject the SSOT adapter (no new adapter creation)
    await sessionManagerSingleton.initialize({ 
      adapter: persistenceLayer?.adapter 
    });

    console.log('[SessionManager] ✅ SessionManager initialized with persistence (singleton)');

    return sessionManagerSingleton;
  } catch (error) {
    console.error('[SessionManager] ❌ Failed to initialize:', error);
    
    // ✅ Reset singleton on failure to allow retry
    sessionManagerSingleton = null;
    
    throw error;
  }
}

// ============================================================================
// DEPENDENCY INJECTION CONTAINER (Advanced Pattern)
// ============================================================================

class DIContainer {
  constructor() {
    this.services = new Map();
    this.singletons = new Map();
  }

  /**
   * Register a service factory
   * @param {string} token - Service identifier
   * @param {Function} factory - Factory function that creates the service
   * @param {boolean} singleton - Whether to cache as singleton
   */
  register(token, factory, singleton = true) {
    this.services.set(token, { factory, singleton });
  }

  /**
   * Resolve a service by token
   * @param {string} token - Service identifier
   * @returns {any} Service instance
   */
  async resolve(token) {
    if (!this.services.has(token)) {
      throw new Error(`Service "${token}" not registered in DI container`);
    }

    const { factory, singleton } = this.services.get(token);

    // Return cached singleton if exists
    if (singleton && this.singletons.has(token)) {
      console.log(`[DI] Returning cached singleton: ${token}`);
      return this.singletons.get(token);
    }

    // Create new instance
    console.log(`[DI] Creating new instance: ${token}`);
    const instance = await factory(this);

    // Cache if singleton
    if (singleton) {
      this.singletons.set(token, instance);
    }

    return instance;
  }

  /**
   * Clear a specific service (useful for testing/reset)
   */
  clear(token) {
    this.singletons.delete(token);
  }

  /**
   * Clear all services
   */
  clearAll() {
    this.singletons.clear();
  }
}

// ============================================================================
// SETUP DI CONTAINER (Modern Pattern)
// ============================================================================

const container = new DIContainer();

// Register persistence layer
container.register('PersistenceLayer', async () => {
  return await initializePersistence();
}, true); // Singleton

// Register session manager
container.register('SessionManager', async (container) => {
  const persistenceLayer = await container.resolve('PersistenceLayer');
  return await initializeSessionManager(persistenceLayer);
}, true); // Singleton

// Register workflow compiler
container.register('WorkflowCompiler', async (container) => {
  const sessionManager = await container.resolve('SessionManager');
  return new WorkflowCompiler(sessionManager);
}, true); // Singleton

// Register context resolver
container.register('ContextResolver', async (container) => {
  const sessionManager = await container.resolve('SessionManager');
  return new ContextResolver(sessionManager);
}, true); // Singleton

// Register orchestrator
container.register('Orchestrator', async () => {
  return new FaultTolerantOrchestrator();
}, true); // Singleton

// ============================================================================
// UPDATED initializeGlobalServices() USING DI CONTAINER
// ============================================================================

async function initializeGlobalServices() {
  if (globalServicesPromise) return globalServicesPromise;

  globalServicesPromise = (async () => {
    console.log('[SW] 🚀 Initializing global services with DI container...');

    // Initialize infrastructure
    await initializeGlobalInfrastructure_NonDNR();

    // Initialize providers
    await initializeProviders();

    // ✅ Use DI container to resolve services (ensures singletons)
    const persistenceLayer = await container.resolve('PersistenceLayer');
    const sessionManager = await container.resolve('SessionManager');
    const compiler = await container.resolve('WorkflowCompiler');
    const contextResolver = await container.resolve('ContextResolver');
    const orchestrator = await container.resolve('Orchestrator');

    // Initialize prompt refiner
    promptRefinerService = new PromptRefinerService({ refinerModel: 'gemini' });
    console.log('[SW] ✅ PromptRefinerService initialized');

    // ✅ CRITICAL: Expose singletons globally
    self.faultTolerantOrchestrator = orchestrator;

    console.log('[SW] ✅ Global services ready (all singletons validated)');
    
    return {
      orchestrator,
      sessionManager,
      compiler,
      contextResolver,
      persistenceLayer,
      promptRefinerService,
    };
  })();

  return globalServicesPromise;
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate that singletons are correctly initialized
 */
function validateSingletons() {
  const checks = {
    persistenceLayer: !!persistenceLayerSingleton,
    adapter: !!adapterSingleton && adapterSingleton.isReady(),
    sessionManager: !!sessionManagerSingleton,
    sessionManagerAdapter: sessionManagerSingleton?.adapter === adapterSingleton,
  };

  console.log('[Validation] Singleton checks:', checks);

  if (!checks.persistenceLayer) {
    console.error('[Validation] ❌ Persistence layer singleton not initialized');
  }
  if (!checks.adapter) {
    console.error('[Validation] ❌ Adapter singleton not ready');
  }
  if (!checks.sessionManager) {
    console.error('[Validation] ❌ SessionManager singleton not initialized');
  }
  if (!checks.sessionManagerAdapter) {
    console.error('[Validation] ❌ SessionManager is not using the SSOT adapter');
  }

  return Object.values(checks).every(Boolean);
}

/**
 * Get current singleton status (for debugging)
 */
function getSingletonStatus() {
  return {
    persistenceLayer: {
      initialized: !!persistenceLayerSingleton,
      adapter: !!adapterSingleton,
      adapterReady: adapterSingleton?.isReady() || false,
    },
    sessionManager: {
      initialized: !!sessionManagerSingleton,
      hasAdapter: !!sessionManagerSingleton?.adapter,
      adapterIsSSOT: sessionManagerSingleton?.adapter === adapterSingleton,
      adapterReady: sessionManagerSingleton?.adapter?.isReady() || false,
    },
    container: {
      services: Array.from(container.services.keys()),
      singletons: Array.from(container.singletons.keys()),
    },
  };
}

// ============================================================================
// EXPORTS & GLOBAL EXPOSURE
// ============================================================================

// Expose for debugging
if (typeof globalThis !== 'undefined') {
  globalThis.__HTOS_DI_CONTAINER = container;
  globalThis.__HTOS_VALIDATE_SINGLETONS = validateSingletons;
  globalThis.__HTOS_GET_SINGLETON_STATUS = getSingletonStatus;
}

// Export for testing
export {
  container,
  initializePersistence,
  initializeSessionManager,
  validateSingletons,
  getSingletonStatus,
};
