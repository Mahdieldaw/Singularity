/**
 * HTOS Claude Provider Adapter
 * - Implements ProviderAdapter interface for Claude
 *
 * Build-phase safe: emitted to dist/adapters/*
 */
import { classifyProviderError } from "../core/request-lifecycle-manager.js";

// Provider-specific adapter debug flag (off by default)
const CLAUDE_ADAPTER_DEBUG = false;
const pad = (...args) => {
  if (CLAUDE_ADAPTER_DEBUG) console.log(...args);
};
export class ClaudeAdapter {
  constructor(controller) {
    this.id = "claude";
    this.capabilities = {
      needsDNR: false,
      needsOffscreen: false,
      supportsStreaming: true,
      supportsContinuation: true,
      synthesis: false,
    };
    this.controller = controller;
  }
  /**
   * Initialize the adapter
   */
  async init() {
    // Initialization logic if needed
    return;
  }
  /**
   * Check if the provider is available and working
   */
  async healthCheck() {
    try {
      // Perform a simple check to verify Claude API is accessible
      return await this.controller.isAvailable();
    } catch (error) {
      return false;
    }
  }
  async sendPrompt(req, onChunk, signal) {
    const startTime = Date.now();
    let aggregatedText = "";
    try {
      // Send prompt to Claude with streaming via callback (ClaudeSessionApi.ask supports onChunk)
      const result = await this.controller.claudeSession.ask(
        req.originalPrompt,
        { signal, chatId: req.meta?.chatId },
        ({ text, chatId, orgId }, isFirstChunk) => {
          if (!this.capabilities.supportsStreaming || !onChunk) return;
          aggregatedText = text || aggregatedText;
          // Forward partials to orchestrator/port
          onChunk({
            providerId: this.id,
            ok: true,
            id: chatId || req.reqId,
            text: aggregatedText,
            partial: true,
            latencyMs: Date.now() - startTime,
            meta: { orgId, chatId },
          });
        },
      );
      // Ensure final text is returned
      aggregatedText = result?.text ?? aggregatedText;
      // Return final result
      return {
        providerId: this.id,
        ok: true,
        id: result?.chatId || req.meta?.chatId || req.reqId, // Use chatId as message ID when available
        text: aggregatedText,
        partial: false,
        latencyMs: Date.now() - startTime,
        meta: {
          orgId: result?.orgId,
          chatId: result?.chatId || req.meta?.chatId,
        },
      };
    } catch (error) {
      // Handle errors with proper classification
      const classification = classifyProviderError("claude-session", error);
      const errorCode = classification.type || "unknown";
      return {
        providerId: this.id,
        ok: false,
        text: null,
        errorCode,
        latencyMs: Date.now() - startTime,
        meta: {
          error: error.toString(),
          details: error.details,
          suppressed: classification.suppressed,
        },
      };
    }
  }

  /**
   * Send continuation message using existing chat context
   * @param {string} prompt - The continuation prompt
   * @param {Object} providerContext - Context containing chatId and other metadata
   * @param {string} sessionId - Session identifier
   * @param {Function} onChunk - Streaming callback
   * @param {AbortSignal} signal - Abort signal
   * @returns {Promise<Object>} Response object
   */
  async sendContinuation(prompt, providerContext, sessionId, onChunk, signal) {
    const startTime = Date.now();
    let aggregatedText = "";

    try {
      // Extract chatId from provider context (support both top-level and nested .meta)
      const meta = providerContext?.meta || providerContext || {};
      const chatId =
        providerContext?.chatId ??
        meta.chatId ??
        providerContext?.threadUrl ??
        meta.threadUrl;

      if (!chatId) {
        console.warn(
          "[ClaudeAdapter] No chatId found in provider context, falling back to new chat",
        );
        // Fall back to regular sendPrompt if no context available
        const meta = providerContext?.meta ?? providerContext ?? {};
        return await this.sendPrompt(
          { originalPrompt: prompt, sessionId, meta },
          onChunk,
          signal,
        );
      }

      // Avoid logging per-continuation start to reduce noisy logs.
      // The adapter will only emit a single completion log after the final response is received.

      // Send continuation to Claude with existing chatId
      const result = await this.controller.claudeSession.ask(
        prompt,
        { signal, chatId },
        ({ text, chatId: newChatId, orgId }, isFirstChunk) => {
          if (!this.capabilities.supportsStreaming || !onChunk) return;
          aggregatedText = text || aggregatedText;

          // Forward partials to orchestrator/port
          onChunk({
            providerId: this.id,
            ok: true,
            id: newChatId || chatId,
            text: aggregatedText,
            partial: true,
            latencyMs: Date.now() - startTime,
            meta: { orgId, chatId: newChatId || chatId },
          });
        },
      );

      // Ensure final text is returned
      aggregatedText = result?.text ?? aggregatedText;

      // Log only the final completion to reduce log volume (gated)
      pad(
        `[ClaudeAdapter] providerComplete: claude status=success, latencyMs=${Date.now() - startTime}, textLen=${(aggregatedText || "").length}`,
      );

      // Return final result with preserved/updated context
      return {
        providerId: this.id,
        ok: true,
        id: result?.chatId || chatId,
        text: aggregatedText,
        partial: false,
        latencyMs: Date.now() - startTime,
        meta: {
          orgId: result?.orgId,
          chatId: result?.chatId || chatId,
          threadUrl: result?.chatId || chatId, // Preserve for future continuations
        },
      };
    } catch (error) {
      // Handle errors with proper classification
      const classification = classifyProviderError("claude-session", error);
      const errorCode = classification.type || "unknown";

      return {
        providerId: this.id,
        ok: false,
        text: null,
        errorCode,
        latencyMs: Date.now() - startTime,
        meta: {
          error: error.toString(),
          details: error.details,
          suppressed: classification.suppressed,
          chatId: providerContext?.chatId ?? meta.chatId, // Preserve context even on error
        },
      };
    }
  }

  /**
   * Unified ask API: prefer continuation when chatId/threadUrl exists, else start new.
   * ask(prompt, providerContext?, sessionId?, onChunk?, signal?)
   */
  async ask(
    prompt,
    providerContext = null,
    sessionId = undefined,
    onChunk = undefined,
    signal = undefined,
  ) {
    try {
      const meta = providerContext?.meta || providerContext || {};
      const hasChat = Boolean(
        meta.chatId || providerContext?.chatId || providerContext?.threadUrl,
      );
      pad(
        `[ProviderAdapter] ASK_STARTED provider=${this.id} hasContext=${hasChat}`,
      );
      let res;
      if (hasChat) {
        res = await this.sendContinuation(
          prompt,
          providerContext,
          sessionId,
          onChunk,
          signal,
        );
      } else {
        res = await this.sendPrompt(
          { originalPrompt: prompt, sessionId, meta },
          onChunk,
          signal,
        );
      }
      try {
        const len = (res?.text || "").length;
        pad(
          `[ProviderAdapter] ASK_COMPLETED provider=${this.id} ok=${res?.ok !== false} textLen=${len}`,
        );
      } catch (_) {}
      return res;
    } catch (e) {
      console.warn(
        `[ProviderAdapter] ASK_FAILED provider=${this.id}:`,
        e?.message || String(e),
      );
      throw e;
    }
  }
}
