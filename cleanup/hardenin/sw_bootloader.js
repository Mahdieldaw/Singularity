// ============================================================================
// HYBRID "STALL-AND-LOAD" BOOTLOADER PATTERN
// Fixes SW termination on slow machines by attaching listeners immediately
// ============================================================================

// === Module-level promise for initialization state ===
let globalServicesPromise = null;

// === EAGER INITIALIZATION (runs in background immediately) ===
(async () => {
  try {
    console.log("[SW:EAGER] Starting critical initialization...");
    
    // 1. CRITICAL: Register DNR rules FIRST (must run before any network requests)
    console.log("[SW:EAGER] Initializing DNR rules...");
    await NetRulesManager.init();
    await ArkoseController.init();
    console.log("[SW:EAGER] ✅ DNR rules ready");

    // 2. Start full service initialization (but don't block listeners)
    console.log("[SW:EAGER] Starting full service initialization...");
    const services = await initializeGlobalServices();
    
    // 3. CRITICAL: Resume inflight workflows (must run headlessly)
    console.log("[SW:EAGER] Resuming inflight workflows...");
    await resumeInflightWorkflows(services);
    console.log("[SW:EAGER] ✅ System fully ready");

  } catch (e) {
    console.error("[SW:EAGER] ❌ Critical initialization failed:", e);
    // Don't throw - listeners should still work
  }
})();

// === LAZY SERVICE INITIALIZATION (memoized) ===
async function initializeGlobalServices() {
  // Return existing promise if already initializing
  if (globalServicesPromise) return globalServicesPromise;

  globalServicesPromise = (async () => {
    console.log("[SW:LAZY] 🚀 Initializing services...");

    // 1. Persistence layer (DB operations)
    const pl = await initializePersistence();
    persistenceLayer = pl;
    self.__HTOS_PERSISTENCE_LAYER = pl;
    
    // 2. Session manager (depends on persistence)
    const sessionManager = await initializeSessionManager(pl);
    
    // 3. Non-DNR infrastructure (DNR already initialized in EAGER path)
    await initializeGlobalInfrastructure_NonDNR();
    
    // 4. Providers
    await initializeProviders();
    
    // 5. Orchestrator
    await initializeOrchestrator();
    
    // 6. Compiler & Resolver
    const compiler = new WorkflowCompiler(sessionManager);
    const contextResolver = new ContextResolver(sessionManager);
    
    // 7. Prompt Refiner
    promptRefinerService = new PromptRefinerService({ refinerModel: "gemini" });
    
    console.log("[SW:LAZY] ✅ All services ready");
    return {
      orchestrator: self.faultTolerantOrchestrator,
      sessionManager,
      compiler,
      contextResolver,
      persistenceLayer: pl,
      promptRefinerService,
    };
  })();

  return globalServicesPromise;
}

// === NON-DNR INFRASTRUCTURE (DNR moved to EAGER path) ===
async function initializeGlobalInfrastructure_NonDNR() {
  console.log("[SW] Initializing non-DNR infrastructure...");
  try {
    // DNR rules already initialized in EAGER path - skip them here
    CSPController.init();
    await UserAgentController.init();
    await OffscreenController.init();
    await BusController.init();
    self.bus = BusController;
  } catch (e) {
    console.error("[SW] Non-DNR infrastructure init failed", e);
  }
}

// ============================================================================
// LISTENERS: ATTACHED IMMEDIATELY (synchronous, top-level)
// ============================================================================

// === onMessage: Immediate attachment, stall-and-load pattern ===
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Ignore bus messages
  if (request?.$bus) return false;

  // Record activity (best-effort, non-blocking)
  try {
    self.lifecycleManager?.recordActivity();
  } catch (_) {}

  // Lightweight pings: respond immediately without awaiting services
  if (request?.type === 'htos.activity') {
    try {
      self.lifecycleManager?.recordActivity();
    } catch (_) {}
    sendResponse({ success: true });
    return true;
  }

  if (request?.type === 'GET_HEALTH_STATUS') {
    try {
      const status = getHealthStatus();
      sendResponse({ success: true, status });
    } catch (e) {
      sendResponse({ success: false, error: e?.message || String(e) });
    }
    return true;
  }

  // All other messages: stall-and-load (await services, then handle)
  if (request?.type) {
    (async () => {
      try {
        // 1. Await services (stalls until ready)
        const services = await initializeGlobalServices();
        
        // 2. Set sessionManager reference (now initialized)
        sessionManager = services.sessionManager;
        
        // 3. Handle the message
        await handleUnifiedMessage(request, sender, sendResponse);
      } catch (e) {
        console.error("[SW] onMessage handler failed:", e);
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true; // Keep channel open for async response
  }

  return false;
});

// === onConnect: Immediate attachment, stall-and-load pattern ===
chrome.runtime.onConnect.addListener(async (port) => {
  if (port.name !== "htos-popup") return;

  // Record activity (best-effort, non-blocking)
  try {
    self.lifecycleManager?.recordActivity();
  } catch (_) {}

  console.log("[SW] New connection received, awaiting services...");

  try {
    // 1. Await services (stalls until ready)
    const services = await initializeGlobalServices();
    
    // 2. Create connection handler
    const handler = new ConnectionHandler(port, services);
    await handler.init();
    
    console.log("[SW] ✅ Connection handler ready");
  } catch (error) {
    console.error("[SW] ❌ Failed to initialize connection handler:", error);
    try {
      port.postMessage({ type: "INITIALIZATION_FAILED", error: error.message });
    } catch (_) {}
  }
});

// ============================================================================
// VALIDATION: Listeners are attached BEFORE any async work
// This guarantees Chrome sees the SW as "ready" immediately
// ============================================================================
console.log("[SW] ✅ Listeners attached (synchronous)");
console.log("[SW] ⏳ Background initialization in progress...");
