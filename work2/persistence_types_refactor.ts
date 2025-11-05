// IndexedDB Schema Type Definitions for HTOS Document Composition System
// REFACTORED: Turn-based context model

// Store configuration types
export interface StoreConfig {
  name: string;
  keyPath: string | string[];
  autoIncrement?: boolean;
  indices: IndexConfig[];
}

export interface IndexConfig {
  name: string;
  keyPath: string | string[];
  unique?: boolean;
  multiEntry?: boolean;
}

// ============================================================================
// 1. Sessions Store (UPDATED: Removed providerContexts, added lastTurnId)
// ============================================================================
export interface SessionRecord {
  id: string;                    // sessionId
  title: string;
  createdAt: number;
  lastActivity: number;
  defaultThreadId: string;        // Always 'default-thread'
  activeThreadId: string;         // Currently active thread
  turnCount: number;              // Denormalized for performance
  isActive: boolean;
  
  // UPDATED SCHEMA:
  lastTurnId?: string;            // ✅ NEW: Quick access to latest turn
  // REMOVED: providerContexts      // ❌ DELETED: Now stored per-turn
  
  updatedAt: number;
  userId?: string;
  provider?: string;
  metadata?: Record<string, any>;
}

// ============================================================================
// 2. Threads Store (Unchanged)
// ============================================================================
export interface ThreadRecord {
  id: string;
  sessionId: string;
  parentThreadId: string | null;
  branchPointTurnId: string | null;
  name: string;
  title: string;
  color: string;
  isActive: boolean;
  createdAt: number;
  lastActivity: number;
  updatedAt: number;
  userId?: string;
  turnCount?: number;
  metadata?: Record<string, any>;
}

// ============================================================================
// 3. Turns Store (UPDATED: Added turn-based context fields)
// ============================================================================
export interface BaseTurnRecord {
  id: string;
  type: 'user' | 'ai';
  sessionId: string;
  threadId: string;
  createdAt: number;
  isDeleted?: boolean;
  
  // UPDATED SCHEMA:
  turnType?: 'initialize' | 'extend' | 'recompute';  // ✅ NEW: Explicit primitive
  parentTurnId?: string;                              // ✅ NEW: Enables branching
  sourceTurnId?: string;                              // ✅ NEW: For recompute turns
  
  updatedAt: number;
  userId?: string;
  role?: string;
  content?: string;
  sequence?: number;
  providerResponseIds?: string[];
}

export interface UserTurnRecord extends BaseTurnRecord {
  type: 'user';
  text: string;
}

export interface AiTurnRecord extends BaseTurnRecord {
  type: 'ai';
  userTurnId: string;
  
  // UPDATED SCHEMA:
  providerContexts?: Record<string, any>;  // ✅ NEW: Turn-scoped provider contexts
  
  meta?: {
    branchPointTurnId?: string;
    replacesId?: string;
    isHistoricalRerun?: boolean;
    synthForUserTurnId?: string;
    
    // ✅ NEW: Recompute-specific metadata
    recomputeMetadata?: {
      stepType?: 'synthesis' | 'mapping';
      originalSynthesizer?: string;
      newSynthesizer?: string;
      originalMapper?: string;
      newMapper?: string;
      targetProvider?: string;
    };
    [key: string]: any;
  };
  
  // Response counts for quick access
  batchResponseCount: number;
  synthesisResponseCount: number;
  mappingResponseCount: number;
}

export type TurnRecord = UserTurnRecord | AiTurnRecord;

// ============================================================================
// 4. Provider Responses Store (Unchanged)
// ============================================================================
export interface ProviderResponseRecord {
  id: string;
  sessionId: string;
  aiTurnId: string;
  providerId: string;
  responseType: 'batch' | 'synthesis' | 'mapping' | 'hidden';
  responseIndex: number;
  text: string;
  status: 'pending' | 'streaming' | 'completed' | 'error' | 'cancelled';
  meta?: any;
  attemptNumber?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
  content?: string;
  metadata?: Record<string, any>;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

// ============================================================================
// 5-9. Other Stores (Unchanged)
// ============================================================================
export interface RefinementEntry {
  id: string;
  timestamp: number;
  type: string;
  description: string;
}

export interface ExportEntry {
  id: string;
  timestamp: number;
  format: string;
  destination: string;
}

export interface DocumentSnapshot {
  id: string;
  timestamp: number;
  canvasContent: any[];
  blockCount: number;
  label?: string;
}

export interface DocumentRecord {
  id: string;
  title: string;
  sourceSessionId?: string;
  sessionId?: string;
  canvasContent: any[];
  canvasTabs?: any[];
  activeTabId?: string;
  granularity: 'full' | 'paragraph' | 'sentence';
  isDirty: boolean;
  createdAt: number;
  lastModified: number;
  version: number;
  blockCount: number;
  refinementHistory: RefinementEntry[];
  exportHistory: ExportEntry[];
  snapshots: DocumentSnapshot[];
  updatedAt: number;
  content?: string;
  metadata?: Record<string, any>;
  type?: string;
}

export interface CanvasBlockRecord {
  id: string;
  documentId: string;
  order: number;
  nodeType: string;
  text: string;
  slateNode: any;
  provenance: {
    sessionId: string;
    aiTurnId: string;
    providerId: string;
    responseType: 'batch' | 'synthesis' | 'mapping' | 'hidden';
    responseIndex: number;
    textRange?: [number, number];
  };
  cachedSourceText?: string;
  isOrphaned?: boolean;
  createdAt: number;
  updatedAt: number;
  parentId?: string;
  children?: string[];
  content?: string;
  metadata?: Record<string, any>;
  type?: string;
}

export interface GhostRecord {
  id: string;
  documentId: string;
  text: string;
  preview: string;
  provenance: {
    sessionId: string;
    aiTurnId: string;
    providerId: string;
    responseType: 'batch' | 'synthesis' | 'mapping' | 'hidden';
    responseIndex: number;
    textRange?: [number, number];
  };
  order: number;
  createdAt: number;
  isPinned: boolean;
  timestamp?: number;
  entityId?: string;
  entityType?: string;
  operation?: string;
  sessionId?: string;
  state?: string;
  metadata?: Record<string, any>;
}

export interface ProviderContextRecord {
  id: string;
  sessionId: string;
  providerId: string;
  threadId?: string;
  meta: any;
  text?: string;
  lastUpdated: number;
  createdAt: number;
  updatedAt: number;
  isActive?: boolean;
  contextData?: any;
  metadata?: Record<string, any>;
}

export interface MetadataRecord {
  id: string;
  key: string;
  entityId?: string;
  entityType?: string;
  sessionId?: string;
  createdAt: number;
  value: any;
  updatedAt: number;
}

// ============================================================================
// NEW: Turn-Based Context Resolution Types
// ============================================================================
export type ResolvedContext = 
  | InitializeContext 
  | ExtendContext 
  | RecomputeContext;

export interface InitializeContext {
  type: 'initialize';
  providers: string[];
  // Empty contexts - each provider starts fresh
}

export interface ExtendContext {
  type: 'extend';
  sessionId: string;
  lastTurnId: string;
  providerContexts: Record<string, any>;  // from last turn
}

export interface RecomputeContext {
  type: 'recompute';
  sessionId: string;
  sourceTurnId: string;
  frozenBatchOutputs: Record<string, any>;  // from source turn
  providerContextsAtSourceTurn: Record<string, any>;  // historical
  stepType: 'synthesis' | 'mapping';
  targetProvider: string;
}

// Utility types for operations
export interface VersionConflictResult {
  success: boolean;
  currentVersion?: number;
}

export interface BatchWriteResult {
  success: boolean;
  errors?: Error[];
}
