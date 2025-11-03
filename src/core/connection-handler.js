// src/core/connection-handler.js

import { WorkflowEngine } from "./workflow-engine.js";

/**
 * ConnectionHandler
 *
 * Production-grade pattern for managing port connections.
 * Each UI connection gets its own isolated handler with proper lifecycle.
 *
 * KEY PRINCIPLES:
 * 1. Connection-scoped: Each port gets its own WorkflowEngine instance
 * 2. Async initialization: Don't attach listeners until backend is ready
 * 3. Proper cleanup: Remove listeners and free resources on disconnect
 * 4. No global state pollution: Everything is encapsulated
 * 5. AGGRESSIVE SESSION HYDRATION: Always re-hydrate from persistence for continuation requests
 */

export class ConnectionHandler {
  constructor(port, services) {
    this.port = port;
    this.services = services; // { orchestrator, sessionManager, compiler }
    this.workflowEngine = null;
    this.messageHandler = null;
    this.isInitialized = false;
    this.lifecycleManager = services.lifecycleManager;
  }

  /**
   * Async initialization - waits for backend readiness
   */
  async init() {
    if (this.isInitialized) return;

    // Create WorkflowEngine for this connection
    this.workflowEngine = new WorkflowEngine(
      this.services.orchestrator,
      this.services.sessionManager,
      this.port
    );

    // Create message handler bound to this instance
    this.messageHandler = this._createMessageHandler();

    // Attach listener
    this.port.onMessage.addListener(this.messageHandler);

    // Attach disconnect handler
    this.port.onDisconnect.addListener(() => this._cleanup());

    this.isInitialized = true;
    console.log("[ConnectionHandler] Initialized for port:", this.port.name);

    // Signal that handler is ready
    this.port.postMessage({ type: "HANDLER_READY" });
  }

  /**
   * Create the message handler function
   * This is separate so we can properly remove it on cleanup
   */
  _createMessageHandler() {
    return async (message) => {
      if (!message || !message.type) return;

      console.log(`[ConnectionHandler] Received: ${message.type}`);

      try {
        switch (message.type) {
          case "EXECUTE_WORKFLOW":
            await this._handleExecuteWorkflow(message);
            break;

          case "KEEPALIVE_PING":
            this.port.postMessage({
              type: "KEEPALIVE_PONG",
              timestamp: Date.now(),
            });
            break;

          case "reconnect":
            this.port.postMessage({
              type: "reconnect_ack",
              serverTime: Date.now(),
            });
            break;

          case "abort":
            await this._handleAbort(message);
            break;

          default:
            console.warn(
              `[ConnectionHandler] Unknown message type: ${message.type}`
            );
        }
      } catch (error) {
        console.error("[ConnectionHandler] Message handling failed:", error);
        this._sendError(message, error);
      }
    };
  }

  /**
   * Handle EXECUTE_WORKFLOW message
   */
  async _handleExecuteWorkflow(message) {
    const executeRequest = message.payload;

    // Record activity for lifecycle manager when workflows are executed
    try {
      if (this.lifecycleManager && typeof this.lifecycleManager.recordActivity === 'function') {
        this.lifecycleManager.recordActivity();
      }
    } catch (e) { }

    try {
      // Activate lifecycle manager before workflow
      this.lifecycleManager?.activateWorkflowMode();

      // Auto-relocate sessionId if needed (after reconnects or UI drift)
      await this._relocateSessionId(executeRequest);

      // CRITICAL: Aggressive session hydration for continuation/historical requests
      await this._ensureSessionHydration(executeRequest);

      // Step 1: Normalize per-provider modes (allows new providers to start fresh)
      this._normalizeProviderModesForContinuation(executeRequest);

      // Step 2: Validate that providers explicitly marked for continuation have context
      const precheck = this._precheckContinuation(executeRequest);
      if (
        precheck &&
        precheck.missingProviders &&
        precheck.missingProviders.length > 0
      ) {
        this._emitContinuationPrecheckFailure(
          executeRequest,
          precheck.missingProviders
        );
        return;
      }

      // --- NEW: Validate presence of userTurnId for historical-only runs ---
      const histUserTurnId = executeRequest?.historicalContext?.userTurnId;
      const userTurnId = executeRequest?.userTurnId || histUserTurnId;
      const hasBatch = Array.isArray(executeRequest?.providers) && executeRequest.providers.length > 0;
      const hasSynthesis = !!(executeRequest?.synthesis?.enabled && Array.isArray(executeRequest?.synthesis?.providers) && executeRequest.synthesis.providers.length > 0);
      const hasMapping = !!(executeRequest?.mapping?.enabled && Array.isArray(executeRequest?.mapping?.providers) && executeRequest.mapping.providers.length > 0);

      // Only fail if the request is mapping/synthesis-only (no batch providers)
      // AND no historical userTurnId was provided. New chats or batch prompts don't need a userTurnId.
      if (!hasBatch && (hasSynthesis || hasMapping) && !userTurnId) {
        console.error("[Backend] Missing userTurnId in historical-only request");
        try {
          this.port.postMessage({
            type: "WORKFLOW_STEP_UPDATE",
            sessionId: executeRequest?.sessionId || "unknown",
            stepId: "validate-user-turn",
            status: "failed",
            errorCode: "missing-user-turn-id",
            error: "Missing userTurnId. Historical runs require a canonical user turn reference.",
          });
        } catch (_) {}
        try {
          this.port.postMessage({
            type: "WORKFLOW_COMPLETE",
            sessionId: executeRequest?.sessionId || "unknown",
          });
        } catch (_) {}
        return;
      }

      // --- NEW: Pre-generate sessionId for new conversations if missing/empty ---
      try {
        const sid = executeRequest?.sessionId;
        if (!sid || sid === "") {
          executeRequest.sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          console.log("[Backend] Generated new session ID:", executeRequest.sessionId);
        }
      } catch (e) {
        console.warn("[Backend] SessionId pre-generation failed, will rely on compiler:", e);
      }

      // Compile high-level request to detailed workflow
      const workflowRequest = this.services.compiler.compile(executeRequest);

      // Decide if this workflow creates a NEW turn (batch prompt present) or
      // appends results to an existing historical turn (mapping/synthesis-only)
      const createsNewTurn = hasBatch;

      if (createsNewTurn) {
        // Generate canonical AI turn ID and attach canonical IDs to context
        const aiTurnId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        workflowRequest.context = {
          ...workflowRequest.context,
          canonicalUserTurnId: userTurnId,
          canonicalAiTurnId: aiTurnId,
        };

        // Send immediate TURN_CREATED acknowledgment before starting workflow
        try {
          this.port.postMessage({
            type: "TURN_CREATED",
            sessionId: executeRequest?.sessionId,
            userTurnId,
            aiTurnId,
          });
        } catch (e) {
          console.warn("[ConnectionHandler] Failed to post TURN_CREATED:", e);
        }
      } else {
        // Historical-only run: attach canonical userTurnId, DO NOT create or emit a new AI turn
        workflowRequest.context = {
          ...workflowRequest.context,
          canonicalUserTurnId: userTurnId,
        };
        console.log('[ConnectionHandler] Historical-only run: skipping TURN_CREATED');
      }

      // Execute via engine
      await this.workflowEngine.execute(workflowRequest);
    } finally {
      // Deactivate lifecycle manager after workflow
      this.lifecycleManager?.deactivateWorkflowMode();
    }
  }

  /**
   * CRITICAL: Ensure session is fully hydrated from persistence
   * This solves the SW restart context loss bug
   */
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

  /**
   * Normalize provider modes for continuation requests:
   * - Providers WITH context → default to 'continuation' (unless explicitly overridden)
   * - Providers WITHOUT context → default to 'new-conversation' (unless explicitly overridden)
   *
   * This allows new providers to join existing chats without triggering errors.
   */
  _normalizeProviderModesForContinuation(executeRequest) {
    try {
      const mode = executeRequest?.mode;
      const sessionId = executeRequest?.sessionId;
      const providers = Array.isArray(executeRequest?.providers)
        ? executeRequest.providers
        : [];
      if (mode !== "continuation" || !sessionId || providers.length === 0)
        return;

      const contexts =
        this.services.sessionManager?.getProviderContexts(
          sessionId,
          "default-thread"
        ) || {};
      const providerModes = { ...(executeRequest?.providerModes || {}) };

      const debug = { hasCtx: {}, before: { ...providerModes } };
      for (const pid of providers) {
        // Respect explicit UI overrides
        if (providerModes[pid]) continue;

        // Auto-assign mode based on context presence
        const hasCtx = !!(
          contexts?.[pid]?.meta && Object.keys(contexts[pid].meta).length > 0
        );
        providerModes[pid] = hasCtx ? "continuation" : "new-conversation";
        debug.hasCtx[pid] = hasCtx;
      }

      executeRequest.providerModes = providerModes;
      console.log(
        `[ConnectionHandler] normalizeProviderModes: session=${sessionId}, mode=${mode}`,
        {
          providers,
          hasCtx: debug.hasCtx,
          after: providerModes,
        }
      );
    } catch (_) {
      // Best-effort; compiler will handle defaults
    }
  }

  /**
   * Fast-fail validation: check if providers explicitly marked for continuation
   * actually have the required context.
   *
   * This catches reconnection bugs where context was lost but shouldn't have been.
   * It does NOT fail for new providers joining an existing chat.
   */
  _precheckContinuation(executeRequest) {
    try {
      const mode = executeRequest?.mode;
      const sessionId = executeRequest?.sessionId;
      const providers = Array.isArray(executeRequest?.providers)
        ? executeRequest.providers
        : [];
      const providerModes = executeRequest?.providerModes || {};

      if (mode !== "continuation" || !sessionId || providers.length === 0)
        return null;

      const contexts =
        this.services.sessionManager?.getProviderContexts(
          sessionId,
          "default-thread"
        ) || {};
      const missing = [];

      for (const pid of providers) {
        const providerMode = providerModes[pid];

        // Only validate providers that SHOULD have context
        // (i.e., explicitly marked as 'continuation')
        if (providerMode !== "continuation") continue;

        const ctxMeta = contexts?.[pid]?.meta;
        if (
          !ctxMeta ||
          (typeof ctxMeta === "object" && Object.keys(ctxMeta).length === 0)
        ) {
          missing.push(pid);
        }
      }

      return { missingProviders: missing };
    } catch (_) {
      return null;
    }
  }

  /**
   * Emit a clean failure message when continuation precheck fails
   */
  _emitContinuationPrecheckFailure(executeRequest, missingProviders) {
    const sid = executeRequest?.sessionId || "unknown";
    const providers = Array.isArray(executeRequest?.providers)
      ? executeRequest.providers
      : [];
    const now = Date.now();
    const stepId = `batch-precheck-${now}`;

    const results = {};
    for (const pid of providers) {
      if (missingProviders.includes(pid)) {
        results[pid] = {
          providerId: pid,
          text: "",
          status: "failed",
          errorCode: "missing-provider-context",
          meta: {
            _rawError: `Cannot continue: missing context for ${pid}. The conversation may have been lost due to a restart. Please start a new chat.`,
          },
        };
      } else {
        // Mark other selected providers as skipped to complete the round cleanly
        results[pid] = {
          providerId: pid,
          text: "",
          status: "failed",
          errorCode: "precheck-skipped",
          meta: {
            _rawError:
              "Request cancelled due to missing context for one or more providers.",
          },
        };
      }
    }

    try {
      this.port.postMessage({
        type: "WORKFLOW_STEP_UPDATE",
        sessionId: sid,
        stepId,
        status: "completed",
        result: { results },
      });
    } catch (_) {}

    try {
      this.port.postMessage({ type: "WORKFLOW_COMPLETE", sessionId: sid });
    } catch (_) {}
  }

  /**
   * Session relocation guard: if the UI sends sessionId=null for a request that
   * is clearly NOT a new conversation (historical mapping/synthesis or continuation),
   * find the correct session to attach to.
   */
  async _relocateSessionId(executeRequest) {
    try {
      const isHistorical = !!executeRequest?.historicalContext?.userTurnId;
      const isContinuation = executeRequest?.mode === "continuation";
      const isNew = executeRequest?.mode === "new-conversation";

      if (isNew) return; // New chat is allowed to pass null to create a session
      if (executeRequest?.sessionId) return; // Already set correctly

      // If historical, search for the session that contains the user turn
      if (isHistorical) {
        const targetTurnId = executeRequest.historicalContext.userTurnId;
        const sessions = this.services.sessionManager?.sessions || {};
        for (const [sid, s] of Object.entries(sessions)) {
          const turns = Array.isArray(s?.turns) ? s.turns : [];
          const idx = turns.findIndex(
            (t) =>
              t?.id === targetTurnId &&
              (t?.type === "user" || t?.role === "user")
          );
          if (idx !== -1) {
            executeRequest.sessionId = sid;
            console.warn(
              `[ConnectionHandler] Relocated historical request to session ${sid}`
            );
            return;
          }
        }
        // Persistence fallback: lookup turnId to find sessionId
        try {
          const sm = this.services.sessionManager;
          if (
            sm?.usePersistenceAdapter &&
            sm?.isInitialized &&
            sm.adapter?.isReady()
          ) {
            const turnRecord = await sm.adapter.get("turns", targetTurnId);
            const foundSid = turnRecord?.sessionId;
            if (foundSid) {
              executeRequest.sessionId = foundSid;
              try {
                await sm.getOrCreateSession(foundSid);
              } catch (_) {}
              console.warn(
                `[ConnectionHandler] Relocated historical request via persistence to session ${foundSid}`
              );
              return;
            }
          }
        } catch (_) {
          /* non-fatal */
        }
        // If not found, let engine fallback search handle it
      }

      // For plain continuation with no explicit historical turn, attach to the most recent session
      if (isContinuation && !executeRequest.sessionId) {
        const sessions = this.services.sessionManager?.sessions || {};
        let bestSid = null;
        let bestTs = -1;
        for (const [sid, s] of Object.entries(sessions)) {
          const ts = Number(s?.lastActivity) || 0;
          if (ts > bestTs) {
            bestTs = ts;
            bestSid = sid;
          }
        }
        if (bestSid) {
          executeRequest.sessionId = bestSid;
          console.warn(
            `[ConnectionHandler] Relocated continuation request to session ${bestSid}`
          );
        }
      }
    } catch (e) {
      // Non-fatal; continue as-is
    }
  }

  /**
   * Handle abort message
   */
  async _handleAbort(message) {
    if (message.sessionId && this.services.orchestrator) {
      this.services.orchestrator._abortRequest(message.sessionId);
    }
  }

  /**
   * Send error back to UI
   */
  _sendError(originalMessage, error) {
    this.port.postMessage({
      type: "WORKFLOW_STEP_UPDATE",
      sessionId: originalMessage.payload?.sessionId || "unknown",
      stepId: "handler-error",
      status: "failed",
      error: error.message || String(error),
    });
  }

  /**
   * Cleanup on disconnect
   */
  _cleanup() {
    console.log("[ConnectionHandler] Cleaning up connection");

    // Deactivate lifecycle manager on disconnect
    this.lifecycleManager?.deactivateWorkflowMode();

    // Remove message listener
    if (this.messageHandler) {
      try {
        this.port.onMessage.removeListener(this.messageHandler);
      } catch (e) {
        // Port may already be dead
      }
    }

    // Null out references for GC
    this.workflowEngine = null;
    this.messageHandler = null;
    this.port = null;
    this.services = null;
    this.lifecycleManager = null;
    this.isInitialized = false;
  }
}
