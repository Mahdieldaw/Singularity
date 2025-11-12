# Unified Implementation Plan: Scratchpad Agent Integration

## Overview
You're building a "Strategist" agent that can query your chat history from within the Scratchpad. The agent uses your existing workflow API (via `ExtensionAPI`) and leverages the indexed database you've already built. This plan consolidates all the feedback into one actionable roadmap.

---

## Phase 1: Database Query Optimization (Foundation)

### Goal
Make your database queries fast enough to support real-time agent operations.

### What You Already Have
- ✅ `byCompoundKey` index on `provider_responses` (v4 schema)
- ✅ Indexed queries for sessions, turns, and contexts
- ✅ `SimpleIndexedDBAdapter` with convenience methods

### What Needs Optimization

#### 1.1 Add Optimized Query to `ContextGraphService`

**File: `src/services/ContextGraphService.ts` (NEW)**

```typescript
import { SimpleIndexedDBAdapter } from '../persistence/SimpleIndexedDBAdapter';
import type { ProvenanceData } from '../composer/extensions/ComposedContentNode';
import type { TurnRecord, ProviderResponseRecord } from '../persistence/types';

export class ContextGraphService {
  private adapter: SimpleIndexedDBAdapter;

  constructor(adapter: SimpleIndexedDBAdapter) {
    this.adapter = adapter;
  }

  /**
   * HIGH-PERFORMANCE: Uses compound index for O(1) lookup
   */
  async getContextByProvenance(provenance: ProvenanceData): Promise<ProviderResponseRecord | null> {
    if (!this.adapter.isReady()) {
      console.warn('[ContextGraph] Adapter not ready');
      return null;
    }

    const { aiTurnId, providerId, responseType, responseIndex } = provenance;

    // Validate inputs
    if (!aiTurnId || !providerId || !responseType) {
      console.warn('[ContextGraph] Invalid provenance:', provenance);
      return null;
    }

    try {
      // Use the existing byCompoundKey index for O(1) lookup
      const responses = await this.adapter.getByIndex(
        'provider_responses',
        'byCompoundKey',
        [aiTurnId, providerId, responseType, responseIndex ?? 0]
      );

      if (!responses || responses.length === 0) {
        console.warn(`[ContextGraph] No response found for provenance:`, provenance);
        return null;
      }

      // Should return exactly one match due to unique constraint
      return responses[0] as ProviderResponseRecord;
    } catch (error) {
      console.error('[ContextGraph] getContextByProvenance failed:', error);
      return null;
    }
  }

  /**
   * OPTIMIZED: Early-exit search with recency sorting
   */
  async searchChatHistory(
    sessionId: string,
    query: string,
    limit: number = 20
  ): Promise<TurnRecord[]> {
    if (!this.adapter.isReady()) {
      console.warn('[ContextGraph] Adapter not ready');
      return [];
    }

    try {
      const lowerQuery = query.toLowerCase();
      const matches: TurnRecord[] = [];

      // Get turns using indexed query (fast)
      const turns = await this.adapter.getTurnsBySessionId(sessionId);

      // Sort by recency (most recent first)
      turns.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

      // Early exit when we have enough matches
      for (const turn of turns) {
        if (matches.length >= limit) break;

        const content = String(turn.content || '').toLowerCase();
        if (content.includes(lowerQuery)) {
          matches.push(turn as TurnRecord);
        }
      }

      return matches;
    } catch (error) {
      console.error('[ContextGraph] searchChatHistory failed:', error);
      return [];
    }
  }

  /**
   * Direct turn lookup by ID (already O(1))
   */
  async getTurnById(turnId: string): Promise<TurnRecord | undefined> {
    if (!this.adapter.isReady()) return undefined;
    return this.adapter.get('turns', turnId) as Promise<TurnRecord | undefined>;
  }

  /**
   * Get recent turns (useful for "what did we just discuss?")
   */
  async getRecentTurns(sessionId: string, limit: number = 10): Promise<TurnRecord[]> {
    if (!this.adapter.isReady()) return [];

    try {
      const turns = await this.adapter.getTurnsBySessionId(sessionId);
      turns.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      return turns.slice(0, limit) as TurnRecord[];
    } catch (error) {
      console.error('[ContextGraph] getRecentTurns failed:', error);
      return [];
    }
  }
}
```

**Why This Works:**
- ✅ Uses your existing `byCompoundKey` index (no schema changes needed)
- ✅ Early-exit search stops after finding enough matches
- ✅ Sorts by recency (most useful results first)
- ✅ Graceful error handling returns empty results instead of crashing

---

## Phase 2: Agent Service Implementation

### Goal
Create the "Strategist" agent that orchestrates tool calls using your existing workflow API.

### 2.1 Create the Agent Service

**File: `src/services/ScratchpadAgentService.ts` (NEW)**

```typescript
import { ContextGraphService } from './ContextGraphService';
import { ExtensionAPI } from '../ui/services/extension-api';
import type { InitializeRequest, ProviderKey } from '../shared/contract';

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
```

---

## Phase 3: UI Integration

### Goal
Wire the agent into your Scratchpad's "Refined" column.

### 3.1 Modify ScratchpadDrawer

**File: `src/components/ScratchpadDrawer.tsx` (MODIFY)**

Add these imports at the top:

```typescript
import { ScratchpadAgentService } from '../services/ScratchpadAgentService';
import { ContextGraphService } from '../services/ContextGraphService';
import { useSessionManager } from '../hooks/useSessionManager';
```

Inside the component, add service initialization:

```typescript
export default function ScratchpadDrawer() {
  // ... existing hooks ...
  const { sessionManager } = useSessionManager();
  
  // Initialize agent service
  const agentService = useMemo(() => {
    if (!sessionManager?.adapter) return null;
    
    const graphService = new ContextGraphService(sessionManager.adapter);
    return new ScratchpadAgentService(graphService);
  }, [sessionManager?.adapter]);

  // Agent UI state
  const [isAgentThinking, setIsAgentThinking] = useState(false);
  const [agentInputValue, setAgentInputValue] = useState('');
  const [selectedAgentModel, setSelectedAgentModel] = useState<ProviderKey>('claude');

  // Agent submit handler
  const handleAgentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentService || !agentInputValue.trim() || !currentSessionId) return;
    
    setIsAgentThinking(true);
    
    try {
      const responseText = await agentService.handlePrompt(
        agentInputValue,
        currentSessionId,
        selectedAgentModel
      );
      
      // Insert response into Refined column as a scratchpad block
      rightEditorRef.current?.insertComposedContent(
        responseText,
        {
          providerId: 'strategist',
          aiTurnId: `agent-${Date.now()}`,
          sessionId: currentSessionId,
          responseType: 'synthesis',
          responseIndex: 0
        } as any
      );
      
      setAgentInputValue('');
    } catch (err) {
      console.error("[Agent] Failed:", err);
      
      // Insert error message
      rightEditorRef.current?.insertComposedContent(
        `Error: ${err instanceof Error ? err.message : 'Agent failed'}`,
        {
          providerId: 'error',
          aiTurnId: 'error',
          sessionId: currentSessionId,
          responseType: 'batch',
          responseIndex: 0
        } as any
      );
    }
    
    setIsAgentThinking(false);
  };

  // ... rest of component ...
```

Add the agent UI in the "Refined" column (replace the existing header):

```typescript
{/* Right: Refined (with agent input) */}
<div ref={rightColumnRef} style={{ ...columnStyle, borderRight: 'none', maxWidth: '30%', position: 'relative' }}>
  <div style={{ padding: 4, fontSize: 11, color: '#64748b', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', gap: 6 }}>
    <span>✨ Refined</span>
    
    {/* Model selector */}
    <select
      value={selectedAgentModel}
      onChange={(e) => setSelectedAgentModel(e.target.value as ProviderKey)}
      style={{
        fontSize: 10,
        padding: '2px 4px',
        borderRadius: 4,
        border: '1px solid #334155',
        background: 'rgba(30,41,59,0.5)',
        color: '#94a3b8'
      }}
    >
      <option value="claude">Claude</option>
      <option value="gemini">Gemini</option>
      <option value="chatgpt">ChatGPT</option>
      <option value="qwen">Qwen</option>
    </select>
  </div>
  
  {/* Agent chat input */}
  <form onSubmit={handleAgentSubmit} style={{ padding: '8px', borderBottom: '1px solid #334155' }}>
    <input
      type="text"
      placeholder="Ask The Strategist..."
      value={agentInputValue}
      onChange={(e) => setAgentInputValue(e.target.value)}
      disabled={isAgentThinking || !agentService}
      style={{
        width: '100%',
        padding: '6px 8px',
        borderRadius: 6,
        border: '1px solid rgba(148,163,184,0.35)',
        background: 'rgba(30,41,59,0.5)',
        color: '#e5e7eb',
        fontSize: 12
      }}
    />
  </form>

  {/* Editor for results */}
  <div
    style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', cursor: floatingSnippet ? 'copy' : 'text' }}
    onClick={(e) => placeSnippetInto('right', e)}
  >
    <CanvasEditorV2
      ref={rightEditorRef}
      placeholder={isAgentThinking ? "Strategist is thinking..." : "Final version..."}
      initialContent={rightContent as any}
      onChange={debouncedUpdateRight}
    />
    {/* ... caret visualization ... */}
  </div>
</div>
```

---

## Testing Checklist

Once implemented, test these scenarios:

### Basic Functionality
- [ ] Type a query in the Refined column input
- [ ] Agent responds with text
- [ ] Response appears as a scratchpad block
- [ ] Loading state shows while thinking

### Tool Usage
- [ ] "What did Claude say about security?" → Uses `searchChatHistory`
- [ ] "Show me turn 123" → Uses `getTurnById`
- [ ] "What did we just discuss?" → Uses `getRecentTurns`

### Error Handling
- [ ] Invalid query doesn't crash
- [ ] Network error shows error message
- [ ] Tool failures are gracefully handled

### Performance
- [ ] Queries complete in <500ms for typical sessions
- [ ] No UI freezing during agent thinking
- [ ] Database queries use indexes (check console logs)

---

## Summary of Changes

| File | Type | Purpose |
|------|------|---------|
| `ContextGraphService.ts` | NEW | High-performance DB query layer |
| `ScratchpadAgentService.ts` | NEW | Agent orchestration + tool calling |
| `ScratchpadDrawer.tsx` | MODIFY | Add agent UI + wire services |

**No database schema changes needed** – your existing v4 schema already has the required indexes.

**No workflow API changes needed** – the agent uses your existing `ExtensionAPI.executeWorkflow` method with `providerMeta` for tool definitions.

This is production-ready architecture: clean separation of concerns, fast queries, graceful error handling, and full integration with your existing systems.