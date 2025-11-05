// src/core/connection-handler.js
/**
 * ConnectionHandler - REFACTORED
 *
 * Production-grade pattern for managing port connections.
 * Each UI connection gets its own isolated handler with proper lifecycle.
 *
 * KEY CHANGES IN THIS REFACTOR:
 * 1. NEW: ContextResolver injected as dependency
 * 2. NEW: 3-phase workflow (Resolve → Compile → Execute)
 * 3. DELETED: _ensureSessionHydration (replaced by ContextResolver)
 * 4. DELETED: _normalizeProviderModesForContinuation (handled by ContextResolver)
 * 5. DELETED: _precheckContinuation (no longer needed)
 * 6. DELETED: _relocateSessionId (context resolution handles this)
 */

import { WorkflowEngine } from "./workflow-engine.js";

export class ConnectionHandler {
  constructor(port, services) {
    this.port = port;
    this.services = services; // { orchestrator, sessionManager, compiler, contextResolver }
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
   * REFACTORED: Handle EXECUTE_WORKFLOW message
   * 
   * NEW 3-PHASE FLOW:
   * 1. Context Resolution (fast, targeted)
   * 2. Workflow Compilation (pure function)
   * 3. Workflow Execution (orchestration)
   */
  async _handleExecuteWorkflow(message) {
    const request = message.payload;

    // Record activity for lifecycle manager
    try {
      if (this.lifecycleManager && typeof this.lifecycleManager.recordActivity === 'function') {
        this.lifecycleManager.recordActivity();
      }
    } catch (e) { }

    try {
      // Activate lifecycle manager before workflow
      this.lifecycleManager?.activateWorkflowMode();

      // ========================================================================
      // PHASE 1: CONTEXT RESOLUTION (NEW)
      // ========================================================================
      console.log('[ConnectionHandler] Phase 1: Resolving context...');
      const resolvedContext = await this.services.contextResolver.resolve(request);
      console.log(`[ConnectionHandler] Context resolved: ${resolvedContext.type}`);

      // ========================================================================
      // PHASE 2: WORKFLOW COMPILATION (UPDATED)
      // ========================================================================
      console.log('[ConnectionHandler] Phase 2: Compiling workflow...');
      const workflowRequest = this.services.compiler.compile(request, resolvedContext);
      console.log(`[ConnectionHandler] Workflow compiled: ${workflowRequest.steps.length} steps`);

      // ========================================================================
      // PHASE 3: WORKFLOW EXECUTION (UPDATED)
      // ========================================================================
      console.log('[ConnectionHandler] Phase 3: Executing workflow...');
      await this.workflowEngine.execute(workflowRequest, resolvedContext);
      console.log('[ConnectionHandler] Workflow execution complete');

    } catch (error) {
      console.error('[ConnectionHandler] Workflow failed:', error);
      
      // Send error to UI
      try {
        this.port.postMessage({
          type: 'WORKFLOW_STEP_UPDATE',
          sessionId: request?.sessionId || 'unknown',
          stepId: 'handler-error',
          status: 'failed',
          error: error.message || String(error)
        });
        
        this.port.postMessage({
          type: 'WORKFLOW_COMPLETE',
          sessionId: request?.sessionId || 'unknown',
          error: error.message || String(error)
        });
      } catch (e) {
        console.error('[ConnectionHandler] Failed to send error message:', e);
      }
    } finally {
      // Deactivate lifecycle manager after workflow
      this.lifecycleManager?.deactivateWorkflowMode();
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
    try {
      this.port.postMessage({
        type: "WORKFLOW_STEP_UPDATE",
        sessionId: originalMessage.payload?.sessionId || "unknown",
        stepId: "handler-error",
        status: "failed",
        error: error.message || String(error),
      });
    } catch (e) {
      console.error('[ConnectionHandler] Failed to send error:', e);
    }
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

// ============================================================================
// DELETED METHODS (No longer needed with ContextResolver)
// ============================================================================
// ❌ _ensureSessionHydration - Replaced by ContextResolver.resolve()
// ❌ _normalizeProviderModesForContinuation - Handled in ContextResolver
// ❌ _precheckContinuation - Context resolution validates everything
// ❌ _emitContinuationPrecheckFailure - No longer needed
// ❌ _relocateSessionId - ContextResolver handles session lookup
