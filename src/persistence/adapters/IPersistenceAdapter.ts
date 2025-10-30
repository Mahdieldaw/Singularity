// Persistence Adapter Interface - Defines the contract for data persistence operations

import type {
  SessionRecord,
  ThreadRecord,
  TurnRecord,
  ProviderResponseRecord,
  DocumentRecord,
  CanvasBlockRecord,
  GhostRecord,
  ProviderContextRecord,
  MetadataRecord
} from '../types';

/**
 * Configuration for persistence adapter initialization
 */
export interface PersistenceConfig {
  /** Database name */
  dbName?: string;
  /** Database version */
  dbVersion?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Connection timeout in milliseconds */
  timeout?: number;
  /** Enable automatic cleanup of old records */
  autoCleanup?: boolean;
  /** Cleanup interval in milliseconds */
  cleanupInterval?: number;
}

/**
 * Query options for data retrieval
 */
export interface QueryOptions {
  /** Maximum number of records to return */
  limit?: number;
  /** Number of records to skip */
  offset?: number;
  /** Sort field */
  sortBy?: string;
  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
  /** Include related records */
  include?: string[];
  /** Filter conditions */
  where?: Record<string, any>;
}

/**
 * Batch operation result
 */
export interface BatchResult<T = any> {
  /** Successfully processed records */
  success: T[];
  /** Failed operations with errors */
  errors: Array<{ record: T; error: Error }>;
  /** Total number of operations attempted */
  total: number;
}

/**
 * Health check result
 */
export interface HealthStatus {
  /** Whether the adapter is healthy */
  healthy: boolean;
  /** Database connection status */
  connected: boolean;
  /** Last successful operation timestamp */
  lastActivity?: number;
  /** Any error messages */
  errors?: string[];
  /** Performance metrics */
  metrics?: {
    avgResponseTime: number;
    totalOperations: number;
    errorRate: number;
  };
}

/**
 * Main persistence adapter interface
 */
export interface IPersistenceAdapter {
  // Lifecycle methods
  initialize(config?: PersistenceConfig): Promise<void>;
  close(): Promise<void>;
  isReady(): boolean;
  getHealth(): Promise<HealthStatus>;

  // Session operations
  createSession(session: Omit<SessionRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<SessionRecord>;
  getSession(id: string): Promise<SessionRecord | null>;
  updateSession(id: string, updates: Partial<SessionRecord>): Promise<SessionRecord>;
  deleteSession(id: string): Promise<boolean>;
  listSessions(options?: QueryOptions): Promise<SessionRecord[]>;
  getSessionsByUserId(userId: string, options?: QueryOptions): Promise<SessionRecord[]>;

  // Thread operations
  createThread(thread: Omit<ThreadRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ThreadRecord>;
  getThread(id: string): Promise<ThreadRecord | null>;
  updateThread(id: string, updates: Partial<ThreadRecord>): Promise<ThreadRecord>;
  deleteThread(id: string): Promise<boolean>;
  listThreads(options?: QueryOptions): Promise<ThreadRecord[]>;
  getThreadsBySessionId(sessionId: string, options?: QueryOptions): Promise<ThreadRecord[]>;

  // Turn operations
  createTurn(turn: Omit<TurnRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<TurnRecord>;
  getTurn(id: string): Promise<TurnRecord | null>;
  updateTurn(id: string, updates: Partial<TurnRecord>): Promise<TurnRecord>;
  deleteTurn(id: string): Promise<boolean>;
  listTurns(options?: QueryOptions): Promise<TurnRecord[]>;
  getTurnsByThreadId(threadId: string, options?: QueryOptions): Promise<TurnRecord[]>;

  // Provider Response operations
  createProviderResponse(response: Omit<ProviderResponseRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProviderResponseRecord>;
  getProviderResponse(id: string): Promise<ProviderResponseRecord | null>;
  updateProviderResponse(id: string, updates: Partial<ProviderResponseRecord>): Promise<ProviderResponseRecord>;
  deleteProviderResponse(id: string): Promise<boolean>;
  listProviderResponses(options?: QueryOptions): Promise<ProviderResponseRecord[]>;
  getProviderResponsesByTurnId(turnId: string, options?: QueryOptions): Promise<ProviderResponseRecord[]>;

  // Document operations
  createDocument(document: Omit<DocumentRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<DocumentRecord>;
  getDocument(id: string): Promise<DocumentRecord | null>;
  updateDocument(id: string, updates: Partial<DocumentRecord>): Promise<DocumentRecord>;
  deleteDocument(id: string): Promise<boolean>;
  listDocuments(options?: QueryOptions): Promise<DocumentRecord[]>;
  getDocumentsBySessionId(sessionId: string, options?: QueryOptions): Promise<DocumentRecord[]>;

  // Canvas Block operations
  createCanvasBlock(block: Omit<CanvasBlockRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<CanvasBlockRecord>;
  getCanvasBlock(id: string): Promise<CanvasBlockRecord | null>;
  updateCanvasBlock(id: string, updates: Partial<CanvasBlockRecord>): Promise<CanvasBlockRecord>;
  deleteCanvasBlock(id: string): Promise<boolean>;
  listCanvasBlocks(options?: QueryOptions): Promise<CanvasBlockRecord[]>;
  getCanvasBlocksByDocumentId(documentId: string, options?: QueryOptions): Promise<CanvasBlockRecord[]>;

  // Ghost operations
  createGhost(ghost: Omit<GhostRecord, 'id' | 'createdAt'>): Promise<GhostRecord>;
  getGhost(id: string): Promise<GhostRecord | null>;
  deleteGhost(id: string): Promise<boolean>;
  listGhosts(options?: QueryOptions): Promise<GhostRecord[]>;
  getGhostsByEntityId(entityId: string, options?: QueryOptions): Promise<GhostRecord[]>;

  // Provider Context operations
  createProviderContext(context: Omit<ProviderContextRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProviderContextRecord>;
  getProviderContext(id: string): Promise<ProviderContextRecord | null>;
  updateProviderContext(id: string, updates: Partial<ProviderContextRecord>): Promise<ProviderContextRecord>;
  deleteProviderContext(id: string): Promise<boolean>;
  listProviderContexts(options?: QueryOptions): Promise<ProviderContextRecord[]>;
  getProviderContextsBySessionId(sessionId: string, options?: QueryOptions): Promise<ProviderContextRecord[]>;

  // Metadata operations
  createMetadata(metadata: Omit<MetadataRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<MetadataRecord>;
  getMetadata(id: string): Promise<MetadataRecord | null>;
  updateMetadata(id: string, updates: Partial<MetadataRecord>): Promise<MetadataRecord>;
  deleteMetadata(id: string): Promise<boolean>;
  listMetadata(options?: QueryOptions): Promise<MetadataRecord[]>;
  getMetadataByEntityId(entityId: string, options?: QueryOptions): Promise<MetadataRecord[]>;

  // Batch operations
  batchCreate<T>(storeName: string, records: T[]): Promise<BatchResult<T>>;
  batchUpdate<T>(storeName: string, updates: Array<{ id: string; data: Partial<T> }>): Promise<BatchResult<T>>;
  batchDelete(storeName: string, ids: string[]): Promise<BatchResult<string>>;

  // Transaction operations
  transaction<T>(
    storeNames: string[],
    mode: 'readonly' | 'readwrite',
    operation: (tx: IDBTransaction) => Promise<T>
  ): Promise<T>;

  // Utility operations
  count(storeName: string, query?: IDBValidKey | IDBKeyRange): Promise<number>;
  clear(storeName: string): Promise<void>;
  export(): Promise<Record<string, any[]>>;
  import(data: Record<string, any[]>): Promise<void>;

  // Event handling
  on(event: 'ready' | 'error' | 'close', handler: (data?: any) => void): void;
  off(event: 'ready' | 'error' | 'close', handler: (data?: any) => void): void;
}