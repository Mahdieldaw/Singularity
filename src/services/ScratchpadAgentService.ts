import { ContextGraphService } from './ContextGraphService';
import type { ProviderKey } from '../../shared/contract';

/**
 * ScratchpadAgentService
 * 
 * Provides a strategic "advisor" agent that:
 * - Reads digests from the main conversation thread
 * - Uses direct provider calls (NOT the workflow engine)
 * - Stores agent contexts separately under "agent:{provider}" keys
 * - Supports continue mode (reuses previous agent context)
 * - Supports new mode (starts fresh, clearing agent contexts)
 */
export class ScratchpadAgentService {
  private contextGraph: ContextGraphService;
  private providerRegistry: any;
  private sessionManager: any;
  private currentAgentModel: ProviderKey | null = null;
  private agentContextKey: string | null = null;

  constructor(contextGraph: ContextGraphService, sessionManager: any, providerRegistry: any) {
    this.contextGraph = contextGraph;
    this.sessionManager = sessionManager;
    this.providerRegistry = providerRegistry;
  }

  /**
   * Handle agent prompt with mode selection
   * @param userInput - The user's question to the agent
   * @param mainSessionId - The main conversation session (for digest context)
   * @param agentModel - Which provider to use for the agent
   * @param options - { mode: 'new' | 'continue' }
   */
  async handlePrompt(
    userInput: string,
    mainSessionId: string,
    agentModel: ProviderKey,
    options: { mode?: 'new' | 'continue' } = {}
  ): Promise<string> {
    const mode = options.mode || 'continue';

    try {
      // Reset agent context if switching models OR explicit new mode
      if (mode === 'new' || agentModel !== this.currentAgentModel) {
        await this.newAgent(mainSessionId);
        this.currentAgentModel = agentModel;
        this.agentContextKey = `agent:${agentModel}`;
      }

      // Build seeded prompt with digest context (only for first message)
      const isFirstMessage = !this.currentAgentModel || mode === 'new';
      const prompt = isFirstMessage 
        ? await this.buildSeededPrompt(userInput, mainSessionId)
        : userInput;

      // Get provider adapter
      const adapter = this.providerRegistry.getAdapter(agentModel);
      if (!adapter) {
        throw new Error(`Provider ${agentModel} not available`);
      }

      // Retrieve agent context (if continuing)
      let agentContext = null;
      if (mode === 'continue' && this.agentContextKey) {
        agentContext = await this.getAgentContext(mainSessionId, this.agentContextKey);
      }

      // Call provider directly
      console.log(`[Agent] Calling ${agentModel} in ${mode} mode`, {
        hasContext: !!agentContext,
        contextKeys: agentContext ? Object.keys(agentContext) : []
      });

      const response = await adapter.ask(
        prompt,
        agentContext, // Pass existing context for continuation
        mainSessionId,
        undefined, // No streaming callback needed
        undefined  // No abort signal
      );

      if (!response || !response.text) {
        throw new Error(`Agent ${agentModel} returned empty response`);
      }

      // Store updated agent context
      await this.storeAgentContext(mainSessionId, this.agentContextKey!, response.meta || {});

      return response.text;
    } catch (error) {
      console.error('[Agent] handlePrompt failed:', error);
      throw error;
    }
  }

  /**
   * Clear agent conversation (start fresh)
   */
  async newAgent(mainSessionId: string): Promise<void> {
    try {
      if (this.agentContextKey) {
        // Clear stored agent context
        await this.clearAgentContext(mainSessionId, this.agentContextKey);
      }
      this.currentAgentModel = null;
      this.agentContextKey = null;
      console.log('[Agent] Agent conversation reset');
    } catch (e) {
      console.warn('[Agent] Failed to clear agent context:', e);
    }
  }

  /**
   * Build seeded prompt with digest context from main session
   * @private
   */
  private async buildSeededPrompt(userInput: string, mainSessionId: string): Promise<string> {
    // Load all turns with digests from main session
    const turns = await this.contextGraph.getTurnsWithDigests(mainSessionId);
    const contextString = this.contextGraph.buildContextFromDigests(turns);

    // Build strategic advisor prompt
    const fullPrompt = `You are "The Strategist," an analytical advisor analyzing an ongoing conversation.

${contextString}

---

USER QUESTION: ${userInput}

Provide a clear, concise, strategic answer based on the conversation history above. Focus on:
- Identifying patterns and insights across the conversation
- Highlighting unresolved tensions or open questions
- Suggesting next steps or clarifying questions
- Drawing connections between different parts of the discussion

Be direct and actionable. Avoid repeating information already discussed unless synthesizing it in a new way.`;

    return fullPrompt;
  }

  /**
   * Retrieve agent context from main session's providerContexts
   * Agent contexts are stored under "agent:{provider}" keys
   * @private
   */
  private async getAgentContext(mainSessionId: string, agentContextKey: string): Promise<any> {
    try {
      // Get session record
      const session = await this.sessionManager.adapter.get('sessions', mainSessionId);
      if (!session || !session.lastTurnId) {
        return null;
      }

      // Get last turn
      const lastTurn = await this.sessionManager.adapter.get('turns', session.lastTurnId);
      if (!lastTurn || !lastTurn.providerContexts) {
        return null;
      }

      // Extract agent context
      const agentContext = lastTurn.providerContexts[agentContextKey];
      if (!agentContext) {
        return null;
      }

      console.log(`[Agent] Retrieved context for ${agentContextKey}:`, Object.keys(agentContext));
      return agentContext;
    } catch (e) {
      console.warn('[Agent] Failed to retrieve agent context:', e);
      return null;
    }
  }

  /**
   * Store agent context in main session's last turn
   * @private
   */
  private async storeAgentContext(mainSessionId: string, agentContextKey: string, meta: any): Promise<void> {
    try {
      // Get session
      const session = await this.sessionManager.adapter.get('sessions', mainSessionId);
      if (!session || !session.lastTurnId) {
        console.warn('[Agent] No last turn to store agent context');
        return;
      }

      // Get last turn
      const lastTurn = await this.sessionManager.adapter.get('turns', session.lastTurnId);
      if (!lastTurn) {
        console.warn('[Agent] Last turn not found');
        return;
      }

      // Update providerContexts with agent context
      lastTurn.providerContexts = lastTurn.providerContexts || {};
      lastTurn.providerContexts[agentContextKey] = meta;
      lastTurn.updatedAt = Date.now();

      // Save turn
      await this.sessionManager.adapter.put('turns', lastTurn);
      
      console.log(`[Agent] Stored context for ${agentContextKey}:`, Object.keys(meta));
    } catch (e) {
      console.error('[Agent] Failed to store agent context:', e);
    }
  }

  /**
   * Clear agent context from main session
   * @private
   */
  private async clearAgentContext(mainSessionId: string, agentContextKey: string): Promise<void> {
    try {
      const session = await this.sessionManager.adapter.get('sessions', mainSessionId);
      if (!session || !session.lastTurnId) return;

      const lastTurn = await this.sessionManager.adapter.get('turns', session.lastTurnId);
      if (!lastTurn || !lastTurn.providerContexts) return;

      delete lastTurn.providerContexts[agentContextKey];
      lastTurn.updatedAt = Date.now();
      await this.sessionManager.adapter.put('turns', lastTurn);

      console.log(`[Agent] Cleared context for ${agentContextKey}`);
    } catch (e) {
      console.warn('[Agent] Failed to clear agent context:', e);
    }
  }
}