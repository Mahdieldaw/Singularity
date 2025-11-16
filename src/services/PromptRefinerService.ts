// src/services/PromptRefinerService.ts

interface TurnContext {
  userPrompt: string;
  synthesisText: string;
  mappingText: string;
  batchText?: string;
}

interface RefinerOptions {
  refinerModel?: string;
}

interface RefinerResult {
  refinedPrompt: string;
  explanation: string;
}

/**
 * PromptRefinerService
 * Pre-flight prompt refinement using a fast, cheap model.
 * Reviews user's draft prompt given full context from last turn.
 */
export class PromptRefinerService {
  private refinerModel: string;

  constructor(options: RefinerOptions = {}) {
    this.refinerModel = (options.refinerModel || 'gemini').toLowerCase();
  }

  /**
   * Refine a draft prompt before sending to 5-way synthesis
   * @param draftPrompt - User's draft prompt
   * @param turnContext - { userPrompt, synthesisText, mappingText }
   * @returns Promise resolving to refined prompt and explanation, or null on failure
   */
  async refinePrompt(draftPrompt: string, turnContext: TurnContext | null = null): Promise<RefinerResult | null> {
    try {
      const prompt = this._buildRefinerPrompt(draftPrompt, turnContext);
      const modelResponse = await this._callRefinerModel(prompt);
      const text = this._extractPlainText(modelResponse?.text || '');
      return this._parseRefinerResponse(text);
    } catch (e) {
      console.warn('[PromptRefinerService] Refinement failed:', e);
      return null;
    }
  }

  private _buildRefinerPrompt(draftPrompt: string, turnContext: TurnContext | null): string {
    let contextSection = '';
    
    if (turnContext) {
      const { userPrompt, synthesisText, mappingText, batchText } = turnContext;
      
      if (userPrompt) {
        contextSection += `\n<PREVIOUS_USER_PROMPT>\n${userPrompt}\n</PREVIOUS_USER_PROMPT>\n`;
      }
      
      if (synthesisText) {
        contextSection += `\n<PREVIOUS_SYNTHESIS>\n${synthesisText}\n</PREVIOUS_SYNTHESIS>\n`;
      }
      
      if (mappingText) {
        contextSection += `\n<PREVIOUS_DECISION_MAP>\n${mappingText}\n</PREVIOUS_DECISION_MAP>\n`;
      }

      if (batchText) {
        contextSection += `\n<PREVIOUS_BATCH_RESPONSES>\n${batchText}\n</PREVIOUS_BATCH_RESPONSES>\n`;
      }
      
      if (contextSection) contextSection += '\n';
    }

    return `You are a prompt refinement assistant. The user is about to send this prompt to 5 different AI models for parallel synthesis.
${contextSection}
<DRAFT_PROMPT>
${draftPrompt}
</DRAFT_PROMPT>

Your task: Review this draft prompt in the context of the conversation and suggest improvements for:

1. **Clarity** - Is the ask unambiguous?
2. **Context** - Does it reference previous insights appropriately? Is there enough information?
3. **Precision** - Are there vague terms that could cause divergent interpretations?
4. **Continuity** - Does it build naturally on what came before, or does it need to reference prior conclusions?
5. **Completeness** - What might be missing given the conversation so far?

Respond in this exact format:

REFINED_PROMPT:
[Your improved version of the prompt, or the original if no changes needed]

EXPLANATION:
[2-3 sentences explaining what you changed and why, or why the original is already good]

Keep your refined prompt concise. Don't add unnecessary elaboration—focus on removing ambiguity, adding essential context, and ensuring continuity with the previous turn.`;
  }

  private async _callRefinerModel(prompt: string): Promise<any> {
    const registry = ((globalThis as any).__HTOS_SW?.getProviderRegistry?.() || (globalThis as any).providerRegistry);
    if (!registry) throw new Error('providerRegistry not available');

    let adapter = registry.getAdapter(this.refinerModel);
    if (!adapter) {
      const fallbacks = ['gemini', 'chatgpt', 'qwen'];
      for (const pid of fallbacks) {
        if (registry.isAvailable(pid)) {
          adapter = registry.getAdapter(pid);
          this.refinerModel = pid;
          break;
        }
      }
    }
    if (!adapter) throw new Error('No provider adapter available for refiner');

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15000);
    
    try {
      if (typeof adapter.ask === 'function') {
        return await adapter.ask(
          prompt,
          { meta: { model: this._preferredModel(adapter) } },
          undefined,
          undefined,
          ac.signal
        );
      } else if (typeof adapter.sendPrompt === 'function') {
        const req = { originalPrompt: prompt, meta: { model: this._preferredModel(adapter) } };
        return await adapter.sendPrompt(req, undefined, ac.signal);
      } else {
        throw new Error('Adapter does not support ask/sendPrompt');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private _preferredModel(adapter: any): string {
    const pid = (adapter?.id || '').toLowerCase();
    if (pid === 'gemini') return 'gemini-flash';
    if (pid === 'chatgpt') return 'gpt-4o-mini';
    return 'auto';
  }

  private _extractPlainText(text: string): string {
    let t = String(text || '').trim();
    t = t.replace(/```[\s\S]*?```/g, '').trim();
    return t;
  }

  private _parseRefinerResponse(text: string): RefinerResult | null {
    try {
      const refinedMatch = text.match(/REFINED_PROMPT:\s*([\s\S]*?)(?=EXPLANATION:|$)/i);
      const explanationMatch = text.match(/EXPLANATION:\s*([\s\S]*?)$/i);

      const refinedPrompt = (refinedMatch?.[1] || '').trim();
      const explanation = (explanationMatch?.[1] || '').trim();

      if (!refinedPrompt) {
        console.warn('[PromptRefinerService] Could not parse refined prompt');
        return null;
      }

      return { refinedPrompt, explanation: explanation || 'No changes needed.' };
    } catch (e) {
      console.warn('[PromptRefinerService] Parse failed:', e);
      return null;
    }
  }
}