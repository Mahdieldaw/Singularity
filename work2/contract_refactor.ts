// ============================================================================
// REFACTORED API CONTRACT: Three Explicit Primitives
// ============================================================================

// ============================================================================
// CORE TYPES & ENUMS
// ============================================================================
export type ProviderKey = "claude" | "gemini" | "gemini-pro" | "chatgpt" | "qwen";
export type WorkflowStepType = "prompt" | "synthesis" | "mapping";
export type WorkflowMode = "new-conversation" | "continuation";  // Kept for backward compat
export type SynthesisStrategy = "continuation" | "fresh";

// ============================================================================
// SECTION 1: UNIFIED EXECUTION REQUEST (UI -> BACKEND) - REFACTORED
// ============================================================================

/**
 * REFACTORED: Three explicit primitives replace the overloaded ExecuteWorkflowRequest
 */
export type WorkflowRequest = 
  | InitializeRequest 
  | ExtendRequest 
  | RecomputeRequest;

/**
 * Initialize: Start a brand new conversation
 * - No sessionId (will be generated)
 * - No historical context
 * - All providers start fresh
 */
export interface InitializeRequest {
  type: 'initialize';
  userMessage: string;
  providers: ProviderKey[];
  includeMapping: boolean;
  includeSynthesis: boolean;
  synthesizer?: ProviderKey;  // Default or specified
  mapper?: ProviderKey;
  useThinking?: boolean;
  
  // Optional per-provider metadata
  providerMeta?: Partial<Record<ProviderKey, any>>;
}

/**
 * Extend: Continue an existing conversation
 * - Requires sessionId
 * - New user message
 * - Can use subset of session's providers
 * - Inherits contexts from last turn
 */
export interface ExtendRequest {
  type: 'extend';
  sessionId: string;
  userMessage: string;
  providers: ProviderKey[];  // Can be subset of session providers
  includeMapping: boolean;
  includeSynthesis: boolean;
  synthesizer?: ProviderKey;
  mapper?: ProviderKey;
  useThinking?: boolean;
  
  // Optional per-provider mode overrides
  providerModes?: Partial<Record<ProviderKey, WorkflowMode>>;
  providerMeta?: Partial<Record<ProviderKey, any>>;
}

/**
 * Recompute: Rerun synthesis or mapping on frozen batch outputs
 * - Requires sessionId and sourceTurnId
 * - No new providers (uses frozen batch)
 * - No new user message (uses source turn's message)
 * - Creates derived turn without advancing main timeline
 */
export interface RecomputeRequest {
  type: 'recompute';
  sessionId: string;
  sourceTurnId: string;       // Which turn to recompute
  stepType: 'synthesis' | 'mapping';  // Which step to rerun
  targetProvider: ProviderKey;  // New synthesizer or mapper
  useThinking?: boolean;
}

export interface ExecuteWorkflowResponse {
  turnId: string;
  workflowId: string;
  status: "processing";
}

// ============================================================================
// SECTION 2: RESOLVED CONTEXT (BACKEND-INTERNAL) - NEW
// ============================================================================

/**
 * Output of ContextResolver - contains all data needed for compilation/execution
 */
export type ResolvedContext = 
  | InitializeContext 
  | ExtendContext 
  | RecomputeContext;

export interface InitializeContext {
  type: 'initialize';
  providers: ProviderKey[];
  // Empty contexts - each provider starts fresh
}

export interface ExtendContext {
  type: 'extend';
  sessionId: string;
  lastTurnId: string;
  providerContexts: Record<ProviderKey, { meta: any; continueThread: boolean }>;
}

export interface RecomputeContext {
  type: 'recompute';
  sessionId: string;
  sourceTurnId: string;
  frozenBatchOutputs: Record<ProviderKey, ProviderResponse>;
  providerContextsAtSourceTurn: Record<ProviderKey, { meta: any }>;
  stepType: 'synthesis' | 'mapping';
  targetProvider: ProviderKey;
  sourceUserMessage: string;  // Original message from source turn
}

// ============================================================================
// SECTION 3: COMPILED WORKFLOW (BACKEND-INTERNAL)
// ============================================================================

export interface PromptStepPayload {
  prompt: string;
  providers: ProviderKey[];
  providerContexts?: Record<
    ProviderKey,
    { meta: any; continueThread: boolean }
  >;
  providerMeta?: Partial<Record<ProviderKey, any>>;
  hidden?: boolean;
  useThinking?: boolean;
}

export interface SynthesisStepPayload {
  synthesisProvider: ProviderKey;
  strategy: SynthesisStrategy;
  sourceStepIds?: string[];
  sourceHistorical?: {
    turnId: string;
    responseType: "batch" | "synthesis" | "mapping";
  };
  originalPrompt: string;
  useThinking?: boolean;
  continueConversationId?: string;
  attemptNumber?: number;
  preferredMappingProvider?: ProviderKey;
}

export interface MappingStepPayload
  extends Omit<SynthesisStepPayload, "synthesisProvider"> {
  mappingProvider: ProviderKey;
}

export interface WorkflowStep {
  stepId: string;
  type: WorkflowStepType;
  payload: PromptStepPayload | SynthesisStepPayload | MappingStepPayload;
}

export interface WorkflowContext {
  sessionId: string;
  threadId: string;
  targetUserTurnId: string;
  sessionCreated?: boolean;
  userMessage?: string;
  canonicalUserTurnId?: string;
  canonicalAiTurnId?: string;
}

export interface WorkflowRequest {
  workflowId: string;
  context: WorkflowContext;
  steps: WorkflowStep[];
}

// ============================================================================
// SECTION 4: REAL-TIME MESSAGING (BACKEND -> UI)
// ============================================================================

export interface PartialResultMessage {
  type: "PARTIAL_RESULT";
  sessionId: string;
  stepId: string;
  providerId: ProviderKey;
  chunk: { text?: string; meta?: any };
}

export interface WorkflowStepUpdateMessage {
  type: "WORKFLOW_STEP_UPDATE";
  sessionId: string;
  stepId: string;
  status: "completed" | "failed";
  result?: {
    results?: Record<string, ProviderResponse>;
    providerId?: string;
    text?: string;
    status?: string;
    meta?: any;
  };
  error?: string;
}

export interface WorkflowCompleteMessage {
  type: "WORKFLOW_COMPLETE";
  sessionId: string;
  workflowId: string;
  finalResults?: Record<string, any>;
  error?: string;
}

export interface TurnCreatedMessage {
  type: "TURN_CREATED";
  sessionId: string;
  userTurnId: string;
  aiTurnId: string;
}

export interface TurnFinalizedMessage {
  type: "TURN_FINALIZED";
  sessionId: string;
  userTurnId: string;
  aiTurnId: string;
  turn: {
    user: {
      id: string;
      type: 'user';
      text: string;
      createdAt: number;
      sessionId: string;
    };
    ai: AiTurn;
  };
}

export type PortMessage =
  | PartialResultMessage
  | WorkflowStepUpdateMessage
  | WorkflowCompleteMessage
  | TurnFinalizedMessage
  | TurnCreatedMessage;

// ============================================================================
// SECTION 5: PERSISTENT DATA MODELS
// ============================================================================

export interface ProviderResponse {
  providerId: string;
  text: string;
  status: "pending" | "streaming" | "completed" | "error";
  createdAt: number;
  updatedAt?: number;
  attemptNumber?: number;
  meta?: {
    conversationId?: string;
    parentMessageId?: string;
    tokenCount?: number;
    thinkingUsed?: boolean;
  };
}

export interface AiTurn {
  id: string;
  type: "ai";
  sessionId: string | null;
  threadId: string;
  userTurnId: string;
  createdAt: number;
  batchResponses: Record<string, ProviderResponse>;
  synthesisResponses: Record<string, ProviderResponse[]>;
  mappingResponses: Record<string, ProviderResponse[]>;
  
  // NEW: Turn-scoped provider contexts
  providerContexts?: Record<string, any>;
  
  meta?: {
    branchPointTurnId?: string;
    replacesId?: string;
    isHistoricalRerun?: boolean;
    synthForUserTurnId?: string;
    [key: string]: any;
  };
}

export interface Thread {
  id: string;
  sessionId: string;
  parentThreadId: string | null;
  branchPointTurnId: string | null;
  name: string;
  color: string;
  isActive: boolean;
  createdAt: number;
  lastActivity: number;
}

// ============================================================================
// TYPE GUARDS
// ============================================================================
export function isPromptPayload(payload: any): payload is PromptStepPayload {
  return "prompt" in payload && "providers" in payload;
}

export function isSynthesisPayload(
  payload: any
): payload is SynthesisStepPayload {
  return "synthesisProvider" in payload;
}

export function isMappingPayload(
  payload: any
): payload is MappingStepPayload {
  return "mappingProvider" in payload;
}

// ============================================================================
// REQUEST TYPE GUARDS - NEW
// ============================================================================
export function isInitializeRequest(req: WorkflowRequest): req is InitializeRequest {
  return req.type === 'initialize';
}

export function isExtendRequest(req: WorkflowRequest): req is ExtendRequest {
  return req.type === 'extend';
}

export function isRecomputeRequest(req: WorkflowRequest): req is RecomputeRequest {
  return req.type === 'recompute';
}
