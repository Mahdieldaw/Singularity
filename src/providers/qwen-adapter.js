/**
 * HTOS Qwen Provider Adapter
 * - Implements ProviderAdapter interface for Qwen
 */
import { classifyProviderError } from "../core/request-lifecycle-manager.js";

// Provider-specific adapter debug flag (off by default)
const QWEN_ADAPTER_DEBUG = false;
const pad = (...args) => {
  if (QWEN_ADAPTER_DEBUG) console.log(...args);
};

export class QwenAdapter {
  constructor(controller) {
    this.id = "qwen";
    this.capabilities = {
      needsDNR: true, // To set origin/referer headers
      needsOffscreen: false,
      supportsStreaming: true,
      supportsContinuation: true,
      synthesis: true,
    };
    this.controller = controller;
  }

  async sendPrompt(req, onChunk, signal) {
    const startTime = Date.now();
    let aggregatedText = "";
    let responseContext = {};

    // Default to continuation when prior context exists (sessionId/parentMsgId),
    // matching behavior of other adapters which reuse meta for continuations.
    const meta = req?.meta || {};
    const hasContinuation = !!(meta.sessionId || meta.parentMsgId);

    try {
      const result = await this.controller.qwenSession.ask(
        req.originalPrompt,
        {
          signal,
          sessionId: hasContinuation ? meta.sessionId : undefined,
          parentMsgId: hasContinuation ? meta.parentMsgId : undefined,
        },
        (partial) => {
          if (!this.capabilities.supportsStreaming || !onChunk) return;
          aggregatedText = partial.text || aggregatedText;
          responseContext = {
            sessionId: partial.sessionId,
            parentMsgId: partial.parentMsgId,
          };

          onChunk({
            providerId: this.id,
            ok: true,
            text: aggregatedText,
            partial: true,
            latencyMs: Date.now() - startTime,
            meta: { ...responseContext },
          });
        },
      );

      return {
        providerId: this.id,
        ok: true,
        text: result.text ?? aggregatedText,
        partial: false,
        latencyMs: Date.now() - startTime,
        meta: { sessionId: result.sessionId, parentMsgId: result.parentMsgId },
      };
    } catch (error) {
      const classification = classifyProviderError("qwen-session", error);
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
          ...meta,
        },
      };
    }
  }

  async sendContinuation(prompt, providerContext, sessionId, onChunk, signal) {
    const startTime = Date.now();
    const meta = providerContext?.meta || providerContext || {};
    let aggregatedText = "";
    let responseContext = {};

    try {
      const result = await this.controller.qwenSession.ask(
        prompt,
        {
          signal,
          sessionId: meta.sessionId,
          parentMsgId: meta.parentMsgId,
        },
        (partial) => {
          if (!this.capabilities.supportsStreaming || !onChunk) return;
          aggregatedText = partial.text || aggregatedText;
          responseContext = {
            sessionId: partial.sessionId,
            parentMsgId: partial.parentMsgId,
          };

          onChunk({
            providerId: this.id,
            ok: true,
            text: aggregatedText,
            partial: true,
            latencyMs: Date.now() - startTime,
            meta: { ...responseContext },
          });
        },
      );

      return {
        providerId: this.id,
        ok: true,
        text: result.text ?? aggregatedText,
        partial: false,
        latencyMs: Date.now() - startTime,
        meta: { sessionId: result.sessionId, parentMsgId: result.parentMsgId },
      };
    } catch (error) {
      const classification = classifyProviderError("qwen-session", error);
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
          ...meta, // Preserve original context on error
        },
      };
    }
  }

  /**
   * Unified ask API: prefer continuation when sessionId/parentMsgId exists, else start new.
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
      const hasContinuation = Boolean(meta.sessionId || meta.parentMsgId);
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
}
