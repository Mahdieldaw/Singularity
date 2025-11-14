// src/services/TurnDigestService.js
// Lightweight digest generator that summarizes a completed turn using
// batch outputs, synthesis, and decision map. Designed to run inside the
// service worker without blocking UI responsiveness.

/**
 * TurnDigestService
 * - Builds a compact digest for an AI turn so downstream agents can use a stable memory.
 * - Uses an available provider adapter (prefers free models like Gemini/Qwen) via the global providerRegistry.
 * - Returns a single plain string paragraph.
 */
export class TurnDigestService {
  constructor(options = {}) {
    this.digestModel = (options.digestModel || 'gemini').toLowerCase();
  }

  /**
   * Generate a digest from a completed turn
   * @param {Object} request - original request { sessionId, userMessage }
   * @param {Object} result - workflow result { batchOutputs, synthesisOutputs, mappingOutputs }
   * @returns {Promise<Object|null>} digest object or null on failure
   */
  async generateDigest(request, result) {
    try {
      const prompt = this._buildDigestPrompt({
        userMessage: String(request?.userMessage || ''),
        batchTexts: this._collectTexts(result?.batchOutputs || {}),
        synthesisText: this._collectFirstText(result?.synthesisOutputs || {}),
        mappingText: this._collectFirstText(result?.mappingOutputs || {}),
      });

      const modelResponse = await this._callDigestModel(prompt);
      const text = this._extractPlainText(modelResponse?.text || '');
      // Return a single paragraph trimmed to ~800 chars for compactness
      const digest = text.slice(0, 800);
      return digest;
    } catch (e) {
      console.warn('[TurnDigestService] Failed to generate digest:', e);
      return null;
    }
  }

  _collectTexts(bucket) {
    const texts = [];
    try {
      for (const [providerId, output] of Object.entries(bucket || {})) {
        const txt = String(output?.text || '').trim();
        if (txt.length > 0) texts.push(`Provider: ${providerId}\n${txt}`);
      }
    } catch (_) {}
    return texts;
  }

  _collectFirstText(bucket) {
    try {
      const first = Object.values(bucket || {})[0];
      return String(first?.text || '').trim();
    } catch (_) {
      return '';
    }
  }

  // Legacy helper removed in plain-string mode

  _buildDigestPrompt({ userMessage, batchTexts, synthesisText, mappingText }) {
    const batchesJoined = (batchTexts || []).join('\n\n');
    const synth = synthesisText ? `\n\n<SYNTHESIS>\n${synthesisText}\n</SYNTHESIS>` : '';
    const map = mappingText ? `\n\n<DECISION_MAP>\n${mappingText}\n</DECISION_MAP>` : '';

  return `You are writing a continuous summary of an ongoing conversation between a user and multiple AI models. You will receive: the user's prompt, responses from five models, a synthesis of those responses, a decision map, and an all-options panel.

Your task: Write a 100-150 word summary of this turn focusing on:

New information, constraints, or assumptions introduced

What decision space exists (options presented, narrowed, or expanded)

Notable agreement or divergence across the responses

What remains unresolved or ambiguous

Write in third person past tense. Do not re-answer the user's question. Do not list which model said what unless the divergence itself is significant. Focus on what changed in the conversation's state.

Format: One dense paragraph, factual tone, no preamble."

<USER_PROMPT>\n${userMessage}\n</USER_PROMPT>

<MODEL_BATCH_OUTPUTS>\n${batchesJoined}\n</MODEL_BATCH_OUTPUTS>${synth}${map}


`;
  }

  async _callDigestModel(prompt) {
    // Access global provider registry from SW
    const registry = (globalThis.__HTOS_SW?.getProviderRegistry?.() || globalThis.providerRegistry);
    if (!registry) throw new Error('providerRegistry not available');

    // Pick adapter: prefer configured digestModel, fall back to available ones
    let adapter = registry.getAdapter(this.digestModel);
    if (!adapter) {
      const fallbacks = ['gemini', 'qwen', 'chatgpt'];
      for (const pid of fallbacks) {
        if (registry.isAvailable(pid)) { adapter = registry.getAdapter(pid); this.digestModel = pid; break; }
      }
    }
    if (!adapter) throw new Error('No provider adapter available for digest');

    // Prepare a short timeout to avoid blocking persistence
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15000);
    try {
      // Prefer adapter.ask if available; else use sendPrompt(req)
      if (typeof adapter.ask === 'function') {
        const res = await adapter.ask(prompt, { meta: { model: this._preferredModel(adapter) } }, undefined, undefined, ac.signal);
        return res;
      } else if (typeof adapter.sendPrompt === 'function') {
        const req = { originalPrompt: prompt, meta: { model: this._preferredModel(adapter) } };
        const res = await adapter.sendPrompt(req, undefined, ac.signal);
        return res;
      } else {
        throw new Error('Adapter does not support ask/sendPrompt');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  _preferredModel(adapter) {
    // Try to pick a fast model if supported
    const pid = (adapter?.id || '').toLowerCase();
    if (pid === 'gemini') return 'gemini-flash';
    if (pid === 'qwen') return '';
    if (pid === 'chatgpt') return 'gpt-4o-mini';
    return 'auto';
  }
  _extractPlainText(text) {
    // Strip code fences and trim to a single paragraph
    let t = String(text || '').trim();
    t = t.replace(/```[\s\S]*?```/g, '').trim();
    // Collapse multiple newlines into spaces to ensure single paragraph
    t = t.replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
    return t;
  }
}