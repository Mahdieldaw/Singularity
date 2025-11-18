/**
 * HTOS ChatGPT Provider Adapter (scaffold)
 * - Implements ProviderAdapter interface for ChatGPT
 *
 * Build-phase safe: emitted to dist/adapters/*
 */
import { classifyProviderError } from "../core/request-lifecycle-manager.js";

// Provider-specific adapter debug flag (off by default)
const CHATGPT_ADAPTER_DEBUG = false;
const pad = (...args) => {
  if (CHATGPT_ADAPTER_DEBUG) console.log(...args);
};

export class ChatGPTAdapter {
  constructor(controller) {
    this.id = "chatgpt";
    this.capabilities = {
      needsDNR: false,
      needsOffscreen: true, // Requires oi Arkose/PoW pipeline
      supportsStreaming: true, // Enable streaming for orchestrator/UI
      supportsContinuation: true,
      synthesis: true,
      supportsThinking: true, // new flag: supports Think-mode
    };
    this.controller = controller;
  }

  /**
   * Unified ask API: prefer continuation when context identifiers exist, else start new.
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
      const hasContinuation = Boolean(
        meta.conversationId || meta.parentMessageId || meta.messageId,
      );
      pad(
        `[ProviderAdapter] ASK_STARTED provider=${this.id} hasContext=${hasContinuation}`,
      );
      let res;
      if (hasContinuation) {
        res = await this.sendContinuation(
          prompt,
          meta,
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

  // Compatibility shim: delegate adapter._getAccessToken to controller
  async _getAccessToken() {
    try {
      if (
        this.controller &&
        typeof this.controller._getAccessToken === "function"
      ) {
        return await this.controller._getAccessToken();
      }
      if (
        this.controller &&
        this.controller.chatgptSession &&
        typeof this.controller.chatgptSession._ensureAccessToken === "function"
      ) {
        const token = await this.controller.chatgptSession._ensureAccessToken();
        return { accessToken: token || null };
      }
      return { error: "no-controller" };
    } catch (e) {
      return { error: (e && e.message) || String(e) };
    }
  }

  /** Initialize the adapter */
  async init() {
    return;
  }

  /**
   * Health check to ensure ChatGPT path is available
   */
  async healthCheck() {
    try {
      return await this.controller.isAvailable();
    } catch {
      return false;
    }
  }

  /**
   * Send prompt to ChatGPT. Mirrors Claude/Gemini adapter contract.
   */
  async sendPrompt(req, onChunk, signal) {
    const startTime = Date.now();
    // Confirmation-only log: do not print prompt contents to console to avoid clogging logs or exposing data.
    pad(`[ChatGPT Adapter] sendPrompt started (provider=${this.id})`);

    try {
      // If Thinking mode requested, route to thinkAsk backend which streams NDJSON
      const useThinking = Boolean(req?.meta?.useThinking);
      if (useThinking) {
        let conversationId = null;
        let lastMessageId = null;
        let observedModel = req.meta?.model || null;
        let aggregated = "";

        const forwardOnChunk = (chunk) => {
          try {
            // preserve identifiers if present on chunk
            if (chunk?.chatId && !conversationId) conversationId = chunk.chatId;
            if (chunk?.id) lastMessageId = chunk.id;
            if (chunk?.model) observedModel = chunk.model;
          } catch (_) {}
          if (onChunk) {
            try {
              onChunk(chunk);
            } catch (_) {}
          }
        };

        // Route think-mode through the authenticated ChatGPT session API to reuse cookies/tokens
        try {
          const result = await this.controller.chatgptSession.ask(
            req.originalPrompt,
            {
              signal,
              model: req.meta?.model,
              // Preserve continuation identifiers where available
              chatId: req.meta?.conversationId,
              parentMessageId: req.meta?.parentMessageId || req.meta?.messageId,
              think: true,
            },
            forwardOnChunk,
          );

          const response = {
            providerId: this.id,
            ok: true,
            id: null,
            text: result?.text ?? aggregated ?? "",
            partial: false,
            latencyMs: Date.now() - startTime,
            meta: {
              model: result?.model || observedModel || "auto",
              conversationId: conversationId || undefined,
              messageId: lastMessageId || undefined,
              parentMessageId: lastMessageId || undefined,
            },
          };
          pad(
            `[ChatGPT Adapter] providerComplete (thinking via session): chatgpt status=success, latencyMs=${response.latencyMs}, textLen=${response.text.length}`,
          );
          return response;
        } catch (e) {
          console.warn(
            "[ChatGPT Adapter] think-mode via session failed, falling back to non-think ask()",
            e,
          );
          // fall through to normal non-thinking flow below
        }
      }

      // Original non-thinking flow delegates to controller.chatgptSession.ask
      let conversationId = null;
      let lastMessageId = null;
      let observedModel = req.meta?.model || null;

      const forwardOnChunk = (chunk) => {
        try {
          if (chunk?.chatId && !conversationId) conversationId = chunk.chatId;
          if (chunk?.id) lastMessageId = chunk.id;
          if (chunk?.model) observedModel = chunk.model;
        } catch (_) {}
        if (onChunk) {
          try {
            onChunk(chunk);
          } catch (_) {}
        }
      };

      const result = await this.controller.chatgptSession.ask(
        req.originalPrompt,
        {
          signal,
          model: req.meta?.model,
          // Preserve continuation context for synthesis when available
          chatId: req.meta?.conversationId,
          parentMessageId: req.meta?.parentMessageId || req.meta?.messageId,
        },
        forwardOnChunk,
      );

      const response = {
        providerId: this.id,
        ok: true,
        id: null,
        text: result?.text ?? "",
        partial: false,
        latencyMs: Date.now() - startTime,
        meta: {
          model: result?.model || observedModel || "auto",
          // Expose continuation identifiers so SessionManager can persist them
          conversationId: conversationId || undefined,
          messageId: lastMessageId || undefined,
          parentMessageId: lastMessageId || undefined,
        },
      };

      // Log only the final completion to reduce log volume
      pad(
        `[ChatGPT Adapter] providerComplete: chatgpt status=success, latencyMs=${response.latencyMs}, textLen=${response.text.length}`,
      );
      return response;
    } catch (error) {
      // Unwrap special thrown thinking-result
      if (error && error.__chatgpt_adapter_thinking_result) {
        return error.__chatgpt_adapter_thinking_result;
      }

      console.error(`[ChatGPT Adapter] Error in sendPrompt:`, {
        error: error.toString(),
        stack: error.stack,
        details: error.details,
        latencyMs: Date.now() - startTime,
      });

      pad(`[ChatGPT Session] providerComplete: chatgpt status=failure`);
      const classification = classifyProviderError("openai-session", error);
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

  async sendContinuation(prompt, providerContext, sessionId, onChunk, signal) {
    // Prefer meta container but also support flattened shapes
    const meta = providerContext?.meta || providerContext || {};
    const conversationIdIn = meta.conversationId;
    const parentMessageIdIn = meta.parentMessageId || meta.messageId;

    pad("[ChatGPT Session] Starting continuation with context:", {
      hasConversationId: !!conversationIdIn,
      hasParentId: !!parentMessageIdIn,
    });

    // If Thinking mode requested for continuation, route to thinkAsk
    if (meta.useThinking) {
      // Delegate to sendPrompt style behavior to reuse streaming think path
      return this.sendPrompt({ originalPrompt: prompt, meta }, onChunk, signal);
    }

    // If no conversation context, fall back to new prompt via sendPrompt
    if (!conversationIdIn) {
      pad(
        "[ChatGPT Session] No conversation context found, falling back to sendPrompt",
      );
      return this.sendPrompt(
        { originalPrompt: prompt, sessionId, meta },
        onChunk,
        signal,
      );
    }

    const startTime = Date.now();

    try {
      // Capture conversation/message identifiers from streaming chunks
      let conversationId = conversationIdIn || null;
      let lastMessageId = null;
      let observedModel = meta?.model || null;

      const forwardOnChunk = (chunk) => {
        try {
          if (chunk?.chatId && !conversationId) conversationId = chunk.chatId;
          if (chunk?.id) lastMessageId = chunk.id;
          if (chunk?.model) observedModel = chunk.model;
        } catch (_) {}
        if (onChunk) {
          try {
            onChunk(chunk);
          } catch (_) {}
        }
      };

      // Delegate continuation to the same ask() path with chatId/parentMessageId
      const result = await this.controller.chatgptSession.ask(
        prompt,
        {
          signal,
          chatId: conversationIdIn,
          parentMessageId: parentMessageIdIn,
          model: observedModel || undefined,
        },
        forwardOnChunk,
      );

      const response = {
        providerId: this.id,
        ok: true,
        id: lastMessageId || null,
        text: result?.text ?? "",
        partial: false,
        latencyMs: Date.now() - startTime,
        meta: {
          model: result?.model || observedModel || "auto",
          conversationId: conversationId || conversationIdIn,
          messageId: lastMessageId || undefined,
          parentMessageId: lastMessageId || parentMessageIdIn || undefined,
        },
      };

      pad(
        `[ChatGPT Session] Continuation completed in ${response.latencyMs}ms, response length: ${response.text.length}`,
      );
      return response;
    } catch (error) {
      console.error(`[ChatGPT Session] Continuation error:`, error);
      // Align error shape with other adapters
      const duration = Date.now() - startTime;
      return {
        providerId: this.id,
        ok: false,
        text: null,
        errorCode: (error && error.type) || "continuation_error",
        latencyMs: duration,
        meta: {
          error: error?.toString?.() || String(error),
          details: error?.details,
          conversationId: conversationIdIn,
          parentMessageId: parentMessageIdIn,
        },
      };
    }
  }
}
