// src/core/connection-handler.js

import { WorkflowEngine } from "./workflow-engine.js";
// Note: ContextResolver is now available via services; we don't import it directly here

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
   * Map new primitive requests into legacy ExecuteWorkflowRequest
   * so the existing compiler/engine can process them without signature changes.
   */

  /**
   * Async initialization - waits for backend readiness
   */
  async init() {
    if (this.isInitialized) return;

    // Create WorkflowEngine for this connection
    this.workflowEngine = new WorkflowEngine(
      this.services.orchestrator,
      this.services.sessionManager,
      this.port,
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

      if (message.type !== "keepalive_ping") {
        console.log(`[ConnectionHandler] Received: ${message.type}`);
      }

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
              `[ConnectionHandler] Unknown message type: ${message.type}`,
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
    let executeRequest = message.payload;
    let resolvedContext = null;

    // Record activity
    try {
      if (
        this.lifecycleManager &&
        typeof this.lifecycleManager.recordActivity === "function"
      ) {
        this.lifecycleManager.recordActivity();
      }
    } catch (e) {}

    try {
      this.lifecycleManager?.activateWorkflowMode();

      // ========================================================================
      // PHASE 5: Primitives-only execution path (fail-fast on legacy)
      // ========================================================================
      const isPrimitive =
        executeRequest &&
        typeof executeRequest.type === "string" &&
        ["initialize", "extend", "recompute"].includes(executeRequest.type);
      if (!isPrimitive) {
        const errMsg =
          '[ConnectionHandler] Non-primitive request rejected. Use {type:"initialize"|"extend"|"recompute"} primitives only.';
        console.error(errMsg, { received: executeRequest });
        try {
          this.port.postMessage({
            type: "WORKFLOW_STEP_UPDATE",
            sessionId: executeRequest?.sessionId || "unknown",
            stepId: "validate-primitive",
            status: "failed",
            error:
              "Legacy ExecuteWorkflowRequest is no longer supported. Please migrate to primitives.",
            // Attach recompute metadata when applicable
            isRecompute: executeRequest?.type === "recompute",
            sourceTurnId: executeRequest?.sourceTurnId,
          });
          this.port.postMessage({
            type: "WORKFLOW_COMPLETE",
            sessionId: executeRequest?.sessionId || "unknown",
            error: "Legacy ExecuteWorkflowRequest is no longer supported.",
          });
        } catch (_) {}
        return;
      }

      // Phase 5 path: Resolve → Map → Compile → Execute
      console.log(
        `[ConnectionHandler] Processing ${executeRequest.type} primitive`,
      );

      // Step 1: Resolve context
      try {
        resolvedContext =
          await this.services.contextResolver.resolve(executeRequest);
        console.log(
          `[ConnectionHandler] Context resolved: ${resolvedContext.type}`,
        );
      } catch (e) {
        console.error("[ConnectionHandler] Context resolution failed:", e);
        throw e;
      }

      // Step 2: No mapping needed - compiler accepts primitives + resolvedContext
      console.log("[ConnectionHandler] Passing primitive directly to compiler");

      // ========================================================================
      // Validation
      // ========================================================================
      const histUserTurnId = executeRequest?.historicalContext?.userTurnId;
      // Prefer primitive's clientUserTurnId; fall back to legacy userTurnId
      const userTurnId =
        executeRequest?.clientUserTurnId ||
        executeRequest?.userTurnId ||
        histUserTurnId;
      const hasBatch =
        Array.isArray(executeRequest?.providers) &&
        executeRequest.providers.length > 0;
      const hasSynthesis = !!(
        executeRequest?.synthesis?.enabled &&
        executeRequest.synthesis.providers?.length > 0
      );
      const hasMapping = !!(
        executeRequest?.mapping?.enabled &&
        executeRequest.mapping.providers?.length > 0
      );

      if (!hasBatch && (hasSynthesis || hasMapping) && !userTurnId) {
        console.error(
          "[ConnectionHandler] Missing userTurnId in historical-only request",
        );
        this.port.postMessage({
          type: "WORKFLOW_STEP_UPDATE",
          sessionId: executeRequest?.sessionId || "unknown",
          stepId: "validate-user-turn",
          status: "failed",
          error: "Missing userTurnId for historical run",
          // Attach recompute metadata when applicable
          isRecompute: executeRequest?.type === "recompute",
          sourceTurnId: executeRequest?.sourceTurnId,
        });
        this.port.postMessage({
          type: "WORKFLOW_COMPLETE",
          sessionId: executeRequest?.sessionId || "unknown",
        });
        return;
      }

      // Generate session ID if needed
      if (!executeRequest?.sessionId || executeRequest.sessionId === "") {
        executeRequest.sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        console.log(
          "[ConnectionHandler] Generated session ID:",
          executeRequest.sessionId,
        );
      }

      // ========================================================================
      // Compile
      // ========================================================================
      const workflowRequest = this.services.compiler.compile(
        executeRequest,
        resolvedContext,
      );
      // ========================================================================
      // TURN_CREATED message
      // ========================================================================
      const createsNewTurn = hasBatch;
      if (createsNewTurn) {
        const aiTurnId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        workflowRequest.context = {
          ...workflowRequest.context,
          canonicalUserTurnId: userTurnId,
          canonicalAiTurnId: aiTurnId,
        };

        try {
          this.port.postMessage({
            type: "TURN_CREATED",
            sessionId:
              workflowRequest.context.sessionId || executeRequest.sessionId,
            userTurnId,
            aiTurnId,
          });
        } catch (_) {}

        try {
          const key = `inflight:${workflowRequest.context.sessionId}:${aiTurnId}`;
          const runId = crypto.randomUUID();
          await this.services.sessionManager.adapter.put("metadata", {
            key,
            sessionId: workflowRequest.context.sessionId,
            entityId: aiTurnId,
            type: "inflight_workflow",
            requestType: executeRequest.type,
            userMessage: executeRequest.userMessage,
            providers: executeRequest.providers || [],
            providerMeta: executeRequest.providerMeta || {},
            runId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        } catch (_) {}
      }

      // NOTE: TURN_CREATED now emits from WorkflowEngine after persistence
      // to ensure authoritative IDs. We no longer emit here to avoid
      // premature/non-canonical IDs.

      // ========================================================================
      // Execute
      // ========================================================================
      await this.workflowEngine.execute(workflowRequest, resolvedContext);

      try {
        const key = `inflight:${workflowRequest.context.sessionId}:${workflowRequest.context.canonicalAiTurnId}`;
        await this.services.sessionManager.adapter.delete("metadata", key);
      } catch (_) {}
    } catch (error) {
      console.error("[ConnectionHandler] Workflow failed:", error);
      try {
        this.port.postMessage({
          type: "WORKFLOW_STEP_UPDATE",
          sessionId: executeRequest?.sessionId || "unknown",
          stepId: "handler-error",
          status: "failed",
          error: error.message || String(error),
          // Attach recompute metadata when applicable
          isRecompute: executeRequest?.type === "recompute",
          sourceTurnId: executeRequest?.sourceTurnId,
        });
        this.port.postMessage({
          type: "WORKFLOW_COMPLETE",
          sessionId: executeRequest?.sessionId || "unknown",
          error: error.message || String(error),
        });
      } catch (e) {
        console.error("[ConnectionHandler] Failed to send error message:", e);
      }
    } finally {
      this.lifecycleManager?.deactivateWorkflowMode();
    }
  }

  /**
   * CRITICAL: Ensure session is fully hydrated from persistence
   * This solves the SW restart context loss bug
   */
  // Legacy hydration helper removed: session hydration now handled by persistence-backed readers

  /**
   * Normalize provider modes for continuation requests:
   * - Providers WITH context → default to 'continuation' (unless explicitly overridden)
   * - Providers WITHOUT context → default to 'new-conversation' (unless explicitly overridden)
   *
   * This allows new providers to join existing chats without triggering errors.
   */
  _normalizeProviderModesForContinuation(executeRequest) {
    // Legacy continuation mode normalization removed; compiler handles defaults and context resolution
  }

  /**
   * Fast-fail validation: check if providers explicitly marked for continuation
   * actually have the required context.
   *
   * This catches reconnection bugs where context was lost but shouldn't have been.
   * It does NOT fail for new providers joining an existing chat.
   */
  _precheckContinuation(executeRequest) {
    // Legacy precheck removed; engine and resolver enforce required contexts
  }

  /**
   * Emit a clean failure message when continuation precheck fails
   */
  // Legacy failure emitter removed; modern workflow emits structured errors directly

  /**
   * Session relocation guard: if the UI sends sessionId=null for a request that
   * is clearly NOT a new conversation (historical mapping/synthesis or continuation),
   * find the correct session to attach to.
   */
  async _relocateSessionId(executeRequest) {
    // Legacy relocation logic removed; primitives carry explicit session context
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
