/**
 * HTOS Gemini Pro Provider Adapter
 * - Separate provider ID 'gemini-pro' that defaults to Gemini 2.5 Pro model
 */
import { classifyProviderError } from "../core/request-lifecycle-manager.js";

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
        }
      );

      // Debug raw provider payload to help diagnose parsing mismatch
      console.info("[GeminiProAdapter] raw result:", result);

      // Normalize text: try common shapes, then fallback to JSON string
      const normalizedText =
        result?.text ??
        (result?.candidates?.[0]?.content ??
          (typeof result === "string" ? result : JSON.stringify(result)));

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
      const cursor = providerContext.cursor;
      const model = providerContext.model || "gemini-pro";

      if (!cursor) {
        const meta = { ...(providerContext?.meta || providerContext || {}), model };
        return await this.sendPrompt(
          { originalPrompt: prompt, sessionId, meta },
          onChunk,
          signal
        );
      }

      const result = await this.controller.geminiSession.ask(prompt, {
        signal,
        cursor,
        model,
      });

      console.info("[GeminiProAdapter] raw continuation result:", result);
      const normalizedText =
        result?.text ??
        (result?.candidates?.[0]?.content ??
          (typeof result === "string" ? result : JSON.stringify(result)));

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
          cursor: providerContext.cursor,
          model: providerContext.model || "gemini-pro",
        },
      };
    }
  }
}
