/
  async _ensureSessionHydration(executeRequest) {
    const isContinuation = executeRequest?.mode === "continuation";
    const isHistorical = !!executeRequest?.historicalContext?.userTurnId;
    const sid = executeRequest?.sessionId;

    // Only hydrate for continuation or historical requests with a valid sessionId
    if ((!isContinuation && !isHistorical) || !sid) {
      console.log(
        "[ConnectionHandler] Skipping hydration: not a continuation/historical request"
      );
      return;
    }

    console.log(`[ConnectionHandler] Starting hydration for session ${sid}...`);
    const sm = this.services.sessionManager;

    // Validate SessionManager is ready
    if (!sm) {
      console.error("[ConnectionHandler] SessionManager is null");
      throw new Error("[ConnectionHandler] SessionManager not available");
    }
    console.log("[ConnectionHandler] SessionManager exists");

    if (!sm.isInitialized) {
      console.warn(
        "[ConnectionHandler] SessionManager not initialized, waiting..."
      );
      // Give it 2 seconds to initialize
      const timeout = 2000;
      const startTime = Date.now();
      while (!sm.isInitialized && Date.now() - startTime < timeout) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!sm.isInitialized) {
        console.error("[ConnectionHandler] SessionManager never initialized");
        throw new Error(
          "[ConnectionHandler] SessionManager initialization timeout"
        );
      }
    }
    console.log("[ConnectionHandler] SessionManager is initialized");

    if (!sm.adapter) {
      console.error("[ConnectionHandler] SessionManager adapter is null");
      throw new Error("[ConnectionHandler] Persistence adapter missing");
    }
    console.log("[ConnectionHandler] SessionManager adapter exists");

    if (!sm.adapter.isReady || !sm.adapter.isReady()) {
      console.error("[ConnectionHandler] Persistence adapter not ready");
      throw new Error("[ConnectionHandler] Persistence adapter not ready");
    }
    console.log("[ConnectionHandler] Persistence adapter is ready");

    console.log(
      `[ConnectionHandler] All checks passed, calling getOrCreateSession(${sid})...`
    );

    try {
      // Wrap hydration with timeout protection
      const HYDRATION_TIMEOUT = 10000; // 10 seconds
      const hydrationPromise = sm.getOrCreateSession(sid);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("Hydration timeout after 10s")),
          HYDRATION_TIMEOUT
        );
      });

      const hydratedSession = await Promise.race([
        hydrationPromise,
        timeoutPromise,
      ]);
      console.log(`[ConnectionHandler] getOrCreateSession returned:`, {
        exists: !!hydratedSession,
        sessionId: hydratedSession?.sessionId,
        hasProviders: !!hydratedSession?.providers,
        providerCount: Object.keys(hydratedSession?.providers || {}).length,
        hasTurns: !!hydratedSession?.turns,
        turnCount: hydratedSession?.turns?.length || 0,
      });

      if (!hydratedSession) {
        throw new Error(
          `[ConnectionHandler] getOrCreateSession returned null for ${sid}`
        );
      }

      // Validate that the session has expected structure
      if (!hydratedSession.sessionId || hydratedSession.sessionId !== sid) {
        throw new Error(
          `[ConnectionHandler] Hydrated session has mismatched ID: ${hydratedSession.sessionId} vs ${sid}`
        );
      }

      // For continuation requests, verify that provider contexts were loaded
      if (isContinuation) {
        const contexts = sm.getProviderContexts(sid, "default-thread") || {};
        const contextCount = Object.keys(contexts).length;

        console.log(
          `[ConnectionHandler] Session ${sid} hydrated with ${contextCount} provider contexts`
        );

        // Log each provider's context for debugging
        Object.entries(contexts).forEach(([providerId, ctx]) => {
          const metaKeys = ctx?.meta ? Object.keys(ctx.meta) : [];
          console.log(
            `[ConnectionHandler] Provider ${providerId} context: ${
              metaKeys.join(", ") || "(empty)"
            }`
          );
        });

        // Note: We don't fail here if contexts are empty because:
        // 1. It might be a legitimate new provider being added
        // 2. The precheck will catch missing contexts for providers that should have them
      }

      console.log(
        `[ConnectionHandler] ✅ Session ${sid} successfully hydrated`
      );
    } catch (error) {
      console.error(
        `[ConnectionHandler] Session hydration failed for ${sid}:`,
        error
      );
      console.error("[ConnectionHandler] Error stack:", error.stack);
      throw new Error(`Failed to hydrate session ${sid}: ${error.message}`);
    }
  }