import { ContextGraphService } from './ContextGraphService';
import ExtensionAPI from '../../ui/services/extension-api';
import type { InitializeRequest, ProviderKey } from '../../shared/contract';

interface AgentResponse {
  type: 'text' | 'tool_call';
  text?: string;
  toolCall?: {
    id: string;
    name: string;
    input: any;
  };
  rawMessage: any;
}

const MAX_TOOL_CALLS = 5; // Safety limit

export class ScratchpadAgentService {
  private contextGraph: ContextGraphService;
  private api: ExtensionAPI;
  private messages: any[] = [];

  constructor(contextGraph: ContextGraphService) {
    this.contextGraph = contextGraph;
    this.api = new ExtensionAPI();
  }

  /**
   * Tool definitions for the LLM
   */
  private readonly AGENT_TOOLS = [
    {
      name: 'getContextByProvenance',
      description: 'Fetches the full text content for a specific block using its provenance metadata.',
      input_schema: {
        type: 'object',
        properties: {
          aiTurnId: { type: 'string', description: 'The AI turn ID' },
          providerId: { type: 'string', description: 'The provider ID (e.g., "claude")' },
          responseType: { type: 'string', description: 'Response type (e.g., "batch", "synthesis")' },
          responseIndex: { type: 'number', description: 'Response index (usually 0)' }
        },
        required: ['aiTurnId', 'providerId', 'responseType', 'responseIndex']
      }
    },
    {
      name: 'searchChatHistory',
      description: 'Searches the entire conversation history for keywords or topics. Returns the most recent matching turns.',
      input_schema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Current session ID' },
          query: { type: 'string', description: 'Search query' }
        },
        required: ['sessionId', 'query']
      }
    },
    {
      name: 'getRecentTurns',
      description: 'Gets the N most recent turns from the conversation.',
      input_schema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Current session ID' },
          limit: { type: 'number', description: 'Number of turns to retrieve (default 10)' }
        },
        required: ['sessionId']
      }
    }
  ];

  /**
   * Main entry point: handles a user prompt with agentic loop
   */
  async handlePrompt(
    userInput: string,
    sessionId: string,
    agentModel: ProviderKey
  ): Promise<string> {
    // System prompt defines the agent's role
    const systemPrompt = `You are "The Strategist," an analytical advisor helping the user understand their conversation history.

You have access to tools that let you search the full conversation and retrieve specific content.

When answering questions:
1. Use tools to find accurate information
2. Cite specific turns when referencing content
3. Be concise and direct
4. If you can't find relevant information, say so

Always use tools when the user asks about past conversation content.`;

    // Initialize conversation with system prompt and user query
    this.messages = [
      { role: 'user', content: systemPrompt }
    ];
    this.messages.push({ role: 'user', content: userInput });

    // Agentic loop: keep calling until we get a text response
    for (let i = 0; i < MAX_TOOL_CALLS; i++) {
      const agentResponse = await this.executeAgentTurn(sessionId, agentModel);

      if (agentResponse.type === 'text') {
        // Success! Return final answer
        return agentResponse.text || 'Done.';
      }

      if (agentResponse.type === 'tool_call') {
        const toolCall = agentResponse.toolCall!;
        
        // Add assistant's tool use to history
        this.messages.push(agentResponse.rawMessage);
        
        // Execute the tool
        console.log(`[Agent] Using tool: ${toolCall.name}`, toolCall.input);
        const toolResult = await this.executeTool(toolCall.name, toolCall.input);
        
        // Add tool result to history
        this.messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: JSON.stringify(toolResult)
            }
          ]
        });
        
        // Loop continues...
      }
    }

    return "Error: Agent exceeded maximum tool calls. Please try a simpler question.";
  }

  /**
   * Execute one turn: call your workflow API with tools
   */
  private async executeAgentTurn(
    sessionId: string,
    agentModel: ProviderKey
  ): Promise<AgentResponse> {
    // Build request using your existing API contract
    const request: InitializeRequest = {
      type: 'initialize',
      sessionId: `agent-${Date.now()}`, // Ephemeral session for agent
      userMessage: '', // Messages are in providerMeta
      providers: [agentModel],
      includeMapping: false,
      includeSynthesis: false,
      providerMeta: {
        [agentModel]: {
          messages: this.messages,
          tools: this.AGENT_TOOLS
        }
      }
    };

    // Call your existing workflow API
    const response = await this.api.executeWorkflow(request);
    
    // Extract the model's response
    const agentOutput = response.batchOutputs?.[agentModel];
    const rawContent = agentOutput?.rawModelResponse?.content;

    if (Array.isArray(rawContent)) {
      // Check for tool use
      const toolUse = rawContent.find((block: any) => block.type === 'tool_use');
      if (toolUse) {
        return {
          type: 'tool_call',
          toolCall: {
            id: toolUse.id,
            name: toolUse.name,
            input: toolUse.input
          },
          rawMessage: { 
            role: 'assistant', 
            content: rawContent 
          }
        };
      }

      // Check for text response
      const textBlock = rawContent.find((block: any) => block.type === 'text');
      if (textBlock) {
        return {
          type: 'text',
          text: textBlock.text,
          rawMessage: { 
            role: 'assistant', 
            content: rawContent 
          }
        };
      }
    }

    // Fallback
    return {
      type: 'text',
      text: agentOutput?.text || "I encountered an error processing your request.",
      rawMessage: { 
        role: 'assistant', 
        content: agentOutput?.text || "" 
      }
    };
  }

  /**
   * Execute tool calls via ContextGraphService
   */
  private async executeTool(toolName: string, input: any): Promise<any> {
    try {
      switch (toolName) {
        case 'getContextByProvenance':
          return await this.contextGraph.getContextByProvenance(input);
        
        case 'searchChatHistory':
          return await this.contextGraph.searchChatHistory(
            input.sessionId,
            input.query,
            20 // Return up to 20 matches
          );
        
        case 'getRecentTurns':
          return await this.contextGraph.getRecentTurns(
            input.sessionId,
            input.limit || 10
          );
        
        default:
          return { error: `Unknown tool: ${toolName}` };
      }
    } catch (error) {
      console.error(`[Agent] Tool execution failed:`, error);
      return { 
        error: `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }
}