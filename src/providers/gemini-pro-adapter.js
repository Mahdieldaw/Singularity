/**
 * HTOS Gemini Pro Provider Adapter
 * - Separate provider ID 'gemini-pro' that defaults to Gemini 2.5 Pro model
 */
import { classifyProviderError } from "../core/request-lifecycle-manager.js";

// Provider-specific adapter debug flag (off by default)
const GEMINI_PRO_ADAPTER_DEBUG = false;
const pad = (...args) => {
  if (GEMINI_PRO_ADAPTER_DEBUG) console.log(...args);
};

export class GeminiProAdapter {
  constructor(controller) {
    this.id = "gemini-pro";
    this.capabilities = {
      needsDNR: false,
      needsOffscreen: false,
      // Keep this in sync with the session implementation.
      // Previously streaming worked; setting true prevents the UI marking completed prematurely.
      supportsStreaming: true,
      supportsContinuation: true,
      synthesis: false,
      supportsModelSelection: false, // Pro variant is fixed
    };
    this.controller = controller;
  }

  async init() {
    return;
  }

  async healthCheck() {
    try {
      return await this.controller.isAvailable();
    } catch {
      return false;
    }
  }

  async sendPrompt(req, onChunk, signal) {
    const startTime = Date.now();
    try {
      const model = "gemini-pro"; // Force Pro model
      const result = await this.controller.geminiSession.ask(
        req.originalPrompt,
        {
          signal,
          cursor: req.meta?.cursor,
          model,
        },
      );

      // Debug raw provider payload to help diagnose parsing mismatch
      if (GEMINI_PRO_ADAPTER_DEBUG)
        console.info("[GeminiProAdapter] raw result:", result);

      // Normalize text: try common shapes, then fallback to JSON string
      const normalizedText =
        result?.text ??
        result?.candidates?.[0]?.content ??
        (typeof result === "string" ? result : JSON.stringify(result));

      // Emit a single partial update so WorkflowEngine treats this like streaming
      try {
        if (onChunk && normalizedText && normalizedText.length > 0) {
          onChunk({
            providerId: this.id,
            ok: true,
            text: normalizedText,
            partial: true,
            latencyMs: Date.now() - startTime,
            meta: {
              cursor: result.cursor,
              token: result.token,
              modelName: result.modelName,
              model,
            },
          });
        }
      } catch (_) {}

      return {
        providerId: this.id,
        ok: true,
        id: null,
        text: normalizedText,
        partial: false,
        latencyMs: Date.now() - startTime,
        meta: {
          cursor: result.cursor,
          token: result.token,
          modelName: result.modelName,
          model,
        },
      };
    } catch (error) {
      const classification = classifyProviderError("gemini-session", error);
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
    const startTime = Date.now();
    try {
      // Support both shapes: top-level and nested under .meta
      const meta = providerContext?.meta || providerContext || {};
      const cursor = providerContext?.cursor ?? meta.cursor;
      const model = (providerContext?.model ?? meta.model) || "gemini-pro";

      if (!cursor) {
        const metaForPrompt = { ...(meta || {}), model };
        return await this.sendPrompt(
          { originalPrompt: prompt, sessionId, meta: metaForPrompt },
          onChunk,
          signal,
        );
      }

      const result = await this.controller.geminiSession.ask(prompt, {
        signal,
        cursor,
        model,
      });

      if (GEMINI_PRO_ADAPTER_DEBUG)
        console.info("[GeminiProAdapter] raw continuation result:", result);
      const normalizedText =
        result?.text ??
        result?.candidates?.[0]?.content ??
        (typeof result === "string" ? result : JSON.stringify(result));

      // Emit a single partial update so WorkflowEngine treats this like streaming
      try {
        if (onChunk && normalizedText && normalizedText.length > 0) {
          onChunk({
            providerId: this.id,
            ok: true,
            text: normalizedText,
            partial: true,
            latencyMs: Date.now() - startTime,
            meta: {
              cursor: result.cursor,
              token: result.token,
              modelName: result.modelName,
              model,
            },
          });
        }
      } catch (_) {}

      return {
        providerId: this.id,
        ok: true,
        id: null,
        text: normalizedText,
        partial: false,
        latencyMs: Date.now() - startTime,
        meta: {
          cursor: result.cursor,
          token: result.token,
          modelName: result.modelName,
          model,
        },
      };
    } catch (error) {
      const classification = classifyProviderError("gemini-session", error);
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
          cursor: providerContext?.cursor ?? meta.cursor,
          model: (providerContext?.model ?? meta.model) || "gemini-pro",
        },
      };
    }
  }

  /**
   * Unified ask API: prefer continuation when cursor exists, else start new.
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
      const hasCursor = Boolean(meta.cursor || providerContext?.cursor);
      pad(
        `[ProviderAdapter] ASK_STARTED provider=${this.id} hasContext=${hasCursor}`,
      );
      let res;
      if (hasCursor) {
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
