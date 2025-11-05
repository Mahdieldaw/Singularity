// ============================================================================
// REFACTORED: Service Worker Initialization (Relevant Sections)
// ============================================================================

// ... (existing imports)

// NEW IMPORT
import { ContextResolver } from './core/context-resolver.js';

// ... (existing code)

// ============================================================================
// GLOBAL SERVICES (single-shot initialization) - REFACTORED
// ============================================================================
let globalServicesReady = null;

async function initializeGlobalServices() {
  if (globalServicesReady) return globalServicesReady;

  globalServicesReady = (async () => {
    console.log("[SW] 🚀 Initializing global services...");
    
    // 1. Initialize persistence layer FIRST
    const pl = await initializePersistence();
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
    
    // 6. Create compiler
    const compiler = new WorkflowCompiler(sessionManager);
    
    // ========================================================================
    // 7. NEW: Create ContextResolver
    // ========================================================================
    console.log("[SW] Creating ContextResolver...");
    const contextResolver = new ContextResolver(sessionManager);
    console.log("[SW] ✅ ContextResolver created");
    
    console.log("[SW] ✅ Global services ready");
    return {
      orchestrator: self.faultTolerantOrchestrator,
      sessionManager: sessionManager,
      compiler,
      contextResolver,  // ✅ NEW: Expose ContextResolver
      persistenceLayer: pl,
      lifecycleManager: self.lifecycleManager
    };
  })();

  return globalServicesReady;
}

// ============================================================================
// PORT CONNECTIONS -> ConnectionHandler per port - REFACTORED
// ============================================================================
chrome.runtime.onConnect.addListener(async (port) => {
  if (port.name !== "htos-popup") return;

  // Record activity on port connections
  try {
    if (self.lifecycleManager && typeof self.lifecycleManager.recordActivity === 'function') {
      self.lifecycleManager.recordActivity();
    }
  } catch (e) { }

  console.log("[SW] New connection received, initializing handler...");

  try {
    const services = await initializeGlobalServices();
    
    // ========================================================================
    // UPDATED: Pass services including ContextResolver
    // ========================================================================
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

// ... (rest of existing code)

// ============================================================================
// UPDATED: Health Check & Debugging
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
    contextResolver: 'active',  // ✅ NEW: Report ContextResolver status
    featureFlags: {
      persistenceAdapter: HTOS_USE_PERSISTENCE_ADAPTER,
      documentPersistence: HTOS_ENABLE_DOCUMENT_PERSISTENCE,
      turnBasedContexts: true  // ✅ NEW: Indicate refactored architecture
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

// ... (rest of existing code)
