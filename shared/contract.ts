// ============================================================================
// CORE TYPES & ENUMS
// ============================================================================
export type ProviderKey = "claude" | "gemini" | "gemini-pro" | "chatgpt" | "qwen";
export type WorkflowStepType = "prompt" | "synthesis" | "mapping";
export type WorkflowMode = "new-conversation" | "continuation";
export type SynthesisStrategy = "continuation" | "fresh";

// ============================================================================
// SECTION 1: UNIFIED EXECUTION REQUEST (UI -> BACKEND)
// SOURCE: This is from your "New Contract" and the core of the new architecture.
// ============================================================================
/**
 * This is the high-level, declarative request the UI sends to the backend.
 * It describes user intent, not execution steps.
 */
export interface ExecuteWorkflowRequest {
  sessionId: string;
  // The canonical ID of the user's turn, generated client-side and REQUIRED
  userTurnId: string;
  threadId: string;
  mode: WorkflowMode; // Global default
  userMessage: string;
  providers: ProviderKey[];

  // Optional per-provider mode overrides (e.g., force new-conversation for a provider)
  providerModes?: Partial<Record<ProviderKey, WorkflowMode>>;

  // Optional per-provider metadata to pass through to adapters (e.g., Gemini model selection)
  providerMeta?: Partial<Record<ProviderKey, any>>;

  // Multi-synthesis: Array of providers that each synthesize
  synthesis?: { enabled: boolean; providers: ProviderKey[] };

  // Multi-mapping: Array of providers that each mapping
  mapping?: { enabled: boolean; providers: ProviderKey[] };

  useThinking?: boolean;

  historicalContext?: {
    userTurnId?: string;
    sourceType?: "batch" | "synthesis" | "mapping";
    attemptNumber?: number;
    branchPointTurnId?: string;
    inheritContextUpTo?: string;
    replaceTurnId?: string;
    preferredMappingProvider?: ProviderKey;
  };
}

export interface ExecuteWorkflowResponse {
  turnId: string;
  workflowId: string;
  status: "processing";
}

// ============================================================================
// SECTION 1b: THREE PRIMITIVES (initialize | extend | recompute)
// Introduced for the turn-based model. ExecuteWorkflowRequest remains for
// backward-compat in legacy surfaces, but the system should migrate to this
// union over time.
// ============================================================================

export type PrimitiveWorkflowRequest = InitializeRequest | ExtendRequest | RecomputeRequest;

export interface InitializeRequest {
  type: 'initialize';
  userMessage: string;
  providers: ProviderKey[];
  includeMapping: boolean;
  includeSynthesis: boolean;
  synthesizer?: ProviderKey;
  mapper?: ProviderKey;
  useThinking?: boolean;
  // Optional per-provider metadata
  providerMeta?: Partial<Record<ProviderKey, any>>;
  // Optional: client-side provisional user turn id so TURN_CREATED can reference it
  clientUserTurnId?: string;
}

export interface ExtendRequest {
  type: 'extend';
  sessionId: string;
  userMessage: string;
  providers: ProviderKey[];
  includeMapping: boolean;
  includeSynthesis: boolean;
  synthesizer?: ProviderKey;
  mapper?: ProviderKey;
  useThinking?: boolean;
  providerModes?: Partial<Record<ProviderKey, WorkflowMode>>;
  providerMeta?: Partial<Record<ProviderKey, any>>;
  // Optional: client-side provisional user turn id so TURN_CREATED can reference it
  clientUserTurnId?: string;
}

export interface RecomputeRequest {
  type: 'recompute';
  sessionId: string;
  sourceTurnId: string;
  stepType: 'synthesis' | 'mapping';
  targetProvider: ProviderKey;
  useThinking?: boolean;
}

// ============================================================================
// SECTION 2: COMPILED WORKFLOW (BACKEND-INTERNAL)
// SOURCE: This is from your "New Contract." It's essential for the backend's internal logic.
// ============================================================================
/**
 * These are the low-level, imperative steps produced by the WorkflowCompiler
 * and consumed by the WorkflowEngine.
 */
export interface PromptStepPayload {
  prompt: string;
  providers: ProviderKey[];
  providerContexts?: Record<
    ProviderKey,
    { meta: any; continueThread: boolean }
  >;
  // Arbitrary per-provider metadata to be forwarded to orchestrator/adapters
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

// NOTE: Added Omit<...> to reduce duplication, but the effective type is the same.
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
// SECTION 2b: RESOLVED CONTEXT (output of ContextResolver)
// ============================================================================

export type ResolvedContext = InitializeContext | ExtendContext | RecomputeContext;

export interface InitializeContext {
  type: 'initialize';
  providers: ProviderKey[];
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
  sourceUserMessage: string;
}

// ============================================================================
// SECTION 3: REAL-TIME MESSAGING (BACKEND -> UI)
// SOURCE: This is from your "New Contract." It defines the streaming communication.
// ============================================================================
/**
 * These are the messages sent from the backend to the UI via the persistent port
 * to provide real-time updates on workflow execution.
 */

export interface PartialResultMessage {
  type: "PARTIAL_RESULT";
  sessionId: string;
  stepId: string;
  providerId: ProviderKey;
  chunk: { text?: string; meta?: any };
}

// NOTE: I made the `result` property more specific and robust here.
export interface WorkflowStepUpdateMessage {
  type: "WORKFLOW_STEP_UPDATE";
  sessionId: string;
  stepId: string;
  status: "completed" | "failed";
  result?: {
    // For batch prompt steps, this will be populated
    results?: Record<string, ProviderResponse>;
    // For single-provider steps (synthesis/mapping), these will be populated
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

// Sent immediately after backend receives ExecuteWorkflowRequest and generates
// the canonical AI turn ID. Establishes canonical IDs up-front to eliminate
// frontend atomic swap/ID remapping.
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
// SECTION 4: PERSISTENT DATA MODELS (FOR UI & SESSION STATE)
// SOURCE: This section is from your "Old Contract" and is MERGED IN here. It's essential.
// ============================================================================
/**
 * These are the core data entities that represent the application's state.
 * They are used for UI rendering and are persisted by the SessionManager.
 */
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
// SOURCE: From your "New Contract."
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
