// ============================================================================
// CORE TYPES & ENUMS
// ============================================================================
export type ProviderKey =
  | "claude"
  | "gemini"
  | "gemini-pro"
  | "chatgpt"
  | "qwen";
export type WorkflowStepType = "prompt" | "synthesis" | "mapping";
export type SynthesisStrategy = "continuation" | "fresh";

// ============================================================================
// SECTION 1: WORKFLOW PRIMITIVES (UI -> BACKEND)
// These are the three fundamental requests the UI can send to the backend.
// ============================================================================

export type PrimitiveWorkflowRequest =
  | InitializeRequest
  | ExtendRequest
  | RecomputeRequest;

/**
 * Starts a new conversation thread.
 */
export interface InitializeRequest {
  type: "initialize";
  sessionId?: string | null; // Optional: can be omitted to let the backend create a new session.
  userMessage: string;
  providers: ProviderKey[];
  includeMapping: boolean;
  includeSynthesis: boolean;
  synthesizer?: ProviderKey;
  mapper?: ProviderKey;
  useThinking?: boolean;
  providerMeta?: Partial<Record<ProviderKey, any>>;
  clientUserTurnId?: string; // Optional: client-side provisional ID for the user's turn.
}

/**
 * Continues an existing conversation with a new user message.
 */
export interface ExtendRequest {
  type: "extend";
  sessionId: string;
  userMessage: string;
  providers: ProviderKey[];
  includeMapping: boolean;
  includeSynthesis: boolean;
  synthesizer?: ProviderKey;
  mapper?: ProviderKey;
  useThinking?: boolean;
  providerMeta?: Partial<Record<ProviderKey, any>>;
  clientUserTurnId?: string; // Optional: client-side provisional ID for the user's turn.
}

/**
 * Re-runs a synthesis or mapping step for a historical turn with a different provider.
 */
export interface RecomputeRequest {
  type: "recompute";
  sessionId: string;
  sourceTurnId: string;
  stepType: "synthesis" | "mapping";
  targetProvider: ProviderKey;
  useThinking?: boolean;
}

// ============================================================================
// SECTION 2: COMPILED WORKFLOW (BACKEND-INTERNAL)
// These are the low-level, imperative steps produced by the WorkflowCompiler.
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
}

export interface WorkflowRequest {
  workflowId: string;
  context: WorkflowContext;
  steps: WorkflowStep[];
}

// ============================================================================
// SECTION 2b: RESOLVED CONTEXT (Output of ContextResolver)
// ============================================================================

export type ResolvedContext =
  | InitializeContext
  | ExtendContext
  | RecomputeContext;

export interface InitializeContext {
  type: "initialize";
  providers: ProviderKey[];
}

export interface ExtendContext {
  type: "extend";
  sessionId: string;
  lastTurnId: string;
  providerContexts: Record<ProviderKey, { meta: any; continueThread: boolean }>;
}

export interface RecomputeContext {
  type: "recompute";
  sessionId: string;
  sourceTurnId: string;
  frozenBatchOutputs: Record<ProviderKey, ProviderResponse>;
  latestMappingOutput?: { providerId: string; text: string; meta: any } | null;
  providerContextsAtSourceTurn: Record<ProviderKey, { meta: any }>;
  stepType: "synthesis" | "mapping";
  targetProvider: ProviderKey;
  sourceUserMessage: string;
}

// ============================================================================
// SECTION 3: REAL-TIME MESSAGING (BACKEND -> UI)
// These are messages sent from the backend to the UI for real-time updates.
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
    results?: Record<string, ProviderResponse>; // For batch steps
    providerId?: string; // For single-provider steps
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
      type: "user";
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
// SECTION 4: PERSISTENT DATA MODELS
// These are the core data entities representing the application's state.
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
  isComplete?: boolean;
  batchResponses: Record<string, ProviderResponse>;
  synthesisResponses: Record<string, ProviderResponse[]>;
  mappingResponses: Record<string, ProviderResponse[]>;
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
  payload: any,
): payload is SynthesisStepPayload {
  return "synthesisProvider" in payload;
}
export function isMappingPayload(payload: any): payload is MappingStepPayload {
  return "mappingProvider" in payload;
}
export function isUserTurn(turn: any): turn is { type: "user" } {
  return !!turn && typeof turn === "object" && turn.type === "user";
}
export function isAiTurn(turn: any): turn is { type: "ai" } {
  return !!turn && typeof turn === "object" && turn.type === "ai";
}
