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
    this.refinerModel = (options.refinerModel || "gemini").toLowerCase();
  }

  /**
   * Refine a draft prompt before sending to 5-way synthesis
   * @param draftPrompt - User's draft prompt
   * @param turnContext - { userPrompt, synthesisText, mappingText }
   * @returns Promise resolving to refined prompt and explanation, or null on failure
   */
  async refinePrompt(
    draftPrompt: string,
    turnContext: TurnContext | null = null,
  ): Promise<RefinerResult | null> {
    try {
      const prompt = this._buildRefinerPrompt(draftPrompt, turnContext);
      const modelResponse = await this._callRefinerModel(prompt);
      const text = this._extractPlainText(modelResponse?.text || "");
      return this._parseRefinerResponse(text);
    } catch (e) {
      console.warn("[PromptRefinerService] Refinement failed:", e);
      return null;
    }
  }

  private _buildRefinerPrompt(
    draftPrompt: string,
    turnContext: TurnContext | null,
  ): string {
    let contextSection = "";

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

      if (contextSection) contextSection += "\n";
    }

    return `You are a prompt refinement assistant analyzing a draft prompt before it's sent to 5 AI models for parallel synthesis.

Your task: Infer the user's true intent by reading between the lines. Look at what they're responding to, what they're building on, what they're pushing back against. Then refine their draft to maximize the quality of responses they'll receive.
${contextSection}

<DRAFT_PROMPT>
${draftPrompt}
</DRAFT_PROMPT>

Analysis Framework:

1. **Intent Inference**
   - What is the user *actually* trying to do, beyond what they literally said?
   - Are they exploring, deciding, clarifying, challenging, or building?
   - If responding to previous outputs: what resonated? what didn't? what's missing?

2. **Clarity Check**
   - Is the ask unambiguous, or could models interpret it differently?
   - Are there vague terms that need grounding?
   - Is the scope clear (broad exploration vs. focused answer)?

3. **Context Completeness**
   - Does the prompt reference relevant insights from previous outputs?
   - Are key constraints or requirements stated explicitly?
   - Would models benefit from knowing what the user already understands?

4. **Continuity Assessment**
   - Does this naturally build on what came before?
   - Should it explicitly reference previous conclusions?
   - Is the user pivoting to something new, and does that need to be clear?

5. **Strategic Framing**
   - Is the prompt framed to elicit depth rather than surface answers?
   - Does it invite models to surface tensions and trade-offs?
   - Would rephrasing unlock better responses?

Output Format:

REFINED_PROMPT:
[Your improved version that captures the user's true intent and maximizes response quality. If no changes needed, return the original.]

EXPLANATION:
[2-4 sentences explaining:
- What you inferred about the user's real intent
- What you changed and why
- How this will improve the responses they receive
OR if unchanged: why the original already captures their intent effectively]

Principles:
- Preserve the user's voice and direction
- Add clarity without adding verbosity
- Make implicit intent explicit only when it helps models respond better
- Don't over-engineer—sometimes the original is already optimal

Begin your analysis.`;
  }

  private async _callRefinerModel(prompt: string): Promise<any> {
    const registry =
      (globalThis as any).__HTOS_SW?.getProviderRegistry?.() ||
      (globalThis as any).providerRegistry;
    if (!registry) throw new Error("providerRegistry not available");

    let adapter = registry.getAdapter(this.refinerModel);
    if (!adapter) {
      const fallbacks = ["gemini", "chatgpt", "qwen"];
      for (const pid of fallbacks) {
        if (registry.isAvailable(pid)) {
          adapter = registry.getAdapter(pid);
          this.refinerModel = pid;
          break;
        }
      }
    }
    if (!adapter) throw new Error("No provider adapter available for refiner");

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15000);

    try {
      if (typeof adapter.ask === "function") {
        return await adapter.ask(
          prompt,
          { meta: { model: this._preferredModel(adapter) } },
          undefined,
          undefined,
          ac.signal,
        );
      } else if (typeof adapter.sendPrompt === "function") {
        const req = {
          originalPrompt: prompt,
          meta: { model: this._preferredModel(adapter) },
        };
        return await adapter.sendPrompt(req, undefined, ac.signal);
      } else {
        throw new Error("Adapter does not support ask/sendPrompt");
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private _preferredModel(adapter: any): string {
    const pid = (adapter?.id || "").toLowerCase();
    if (pid === "gemini") return "gemini-flash";
    if (pid === "chatgpt") return "gpt-4o-mini";
    return "auto";
  }

  private _extractPlainText(text: string): string {
    let t = String(text || "").trim();
    t = t.replace(/```[\s\S]*?```/g, "").trim();
    return t;
  }

  private _parseRefinerResponse(text: string): RefinerResult | null {
    try {
      const refinedMatch = text.match(
        /REFINED_PROMPT:\s*([\s\S]*?)(?=EXPLANATION:|$)/i,
      );
      const explanationMatch = text.match(/EXPLANATION:\s*([\s\S]*?)$/i);

      const refinedPrompt = (refinedMatch?.[1] || "").trim();
      const explanation = (explanationMatch?.[1] || "").trim();

      if (!refinedPrompt) {
        console.warn("[PromptRefinerService] Could not parse refined prompt");
        return null;
      }

      return {
        refinedPrompt,
        explanation: explanation || "No changes needed.",
      };
    } catch (e) {
      console.warn("[PromptRefinerService] Parse failed:", e);
      return null;
    }
  }
}
