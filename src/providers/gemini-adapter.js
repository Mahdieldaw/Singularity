/**
 * HTOS Gemini Provider Adapter
 * - Implements ProviderAdapter interface for Gemini
 *
 * Build-phase safe: emitted to dist/adapters/*
 */
import { classifyProviderError } from "../core/request-lifecycle-manager.js";

export class GeminiAdapter {
  constructor(controller) {
    this.id = "gemini";
    this.capabilities = {
      needsDNR: false,
      needsOffscreen: false,
      supportsStreaming: false,
      supportsContinuation: true,
      synthesis: false,
      supportsModelSelection: true, // NEW: Indicate model selection support
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
      // Perform a simple check to verify Gemini API is accessible
      return await this.controller.isAvailable();
    } catch (error) {
      return false;
    }
  }

  async sendPrompt(req, onChunk, signal) {
    const startTime = Date.now();
    try {
      // Extract model from request metadata (defaults to "gemini-flash")
      const model = req.meta?.model || "gemini-flash";

      console.log(`[GeminiAdapter] Sending prompt with model: ${model}`);

      // Send prompt to Gemini with model selection
      const result = await this.controller.geminiSession.ask(
        req.originalPrompt,
        {
          signal,
          cursor: req.meta?.cursor,
          model, // Pass model to the API
        }
      );

      // Return final result
      return {
        providerId: this.id,
        ok: true,
        id: null, // Request ID not available in BatchRequest type
        text: result.text,
        partial: false,
        latencyMs: Date.now() - startTime,
        meta: {
          cursor: result.cursor,
          token: result.token,
          modelName: result.modelName,
          model, // Preserve model in response
        },
      };
    } catch (error) {
      // Handle errors with proper classification
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

  /**
   * Send continuation message using existing cursor context
   * @param {string} prompt - The continuation prompt
   * @param {Object} providerContext - Context containing cursor and other metadata
   * @param {string} sessionId - Session identifier
   * @param {Function} onChunk - Streaming callback
   * @param {AbortSignal} signal - Abort signal
   * @returns {Promise<Object>} Response object
   */
  async sendContinuation(prompt, providerContext, sessionId, onChunk, signal) {
    const startTime = Date.now();

    try {
      // Extract cursor and model from provider context
      const cursor = providerContext.cursor;
      const model = providerContext.model || "gemini-flash";

      if (!cursor) {
        console.warn(
          "[GeminiAdapter] No cursor found in provider context, falling back to new chat"
        );
        // Fall back to regular sendPrompt if no context available
        const meta = {
          ...(providerContext?.meta || providerContext || {}),
          model, // Preserve model selection
        };
        return await this.sendPrompt(
          { originalPrompt: prompt, sessionId, meta },
          onChunk,
          signal
        );
      }

      console.log(
        `[GeminiAdapter] Continuing chat with cursor and model: ${model}`
      );

      // Send continuation to Gemini with existing cursor and model
      const result = await this.controller.geminiSession.ask(prompt, {
        signal,
        cursor,
        model,
      });

      // Return final result with preserved/updated context
      return {
        providerId: this.id,
        ok: true,
        id: null,
        text: result.text,
        partial: false,
        latencyMs: Date.now() - startTime,
        meta: {
          cursor: result.cursor, // Updated cursor for future continuations
          token: result.token,
          modelName: result.modelName,
          model, // Preserve model for next continuation
        },
      };
    } catch (error) {
      // Handle errors with proper classification
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
          cursor: providerContext.cursor, // Preserve context even on error
          model: providerContext.model, // Preserve model even on error
        },
      };
    }
  }
}
