// IndexedDB Persistence Adapter Implementation

import { openDatabase, checkDatabaseHealth } from '../database';
import { withTransaction } from '../transactions';
import { createRepositories, type RepositoryCollection } from '../repositories/index';
import type {
  IPersistenceAdapter,
  PersistenceConfig,
  QueryOptions,
  BatchResult,
  HealthStatus
} from './IPersistenceAdapter';
import type {
  SessionRecord,
  ThreadRecord,
  TurnRecord,
  UserTurnRecord,
  AiTurnRecord,
  ProviderResponseRecord,
  DocumentRecord,
  CanvasBlockRecord,
  GhostRecord,
  ProviderContextRecord,
  MetadataRecord
} from '../types';

/**
 * IndexedDB implementation of the persistence adapter
 */
export class IndexedDBAdapter implements IPersistenceAdapter {
  private db: IDBDatabase | null = null;
  private repositories: RepositoryCollection | null = null;
  private config: PersistenceConfig = {};
  private eventHandlers: Map<string, Set<Function>> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private metrics = {
    totalOperations: 0,
    errorCount: 0,
    responseTimes: [] as number[]
  };

  constructor() {
    // Initialize event handler maps
    this.eventHandlers.set('ready', new Set());
    this.eventHandlers.set('error', new Set());
    this.eventHandlers.set('close', new Set());
  }

  // Lifecycle methods
  async initialize(config: PersistenceConfig = {}): Promise<void> {
    console.warn('persistence:init - Starting IndexedDBAdapter initialization');
    
    this.config = {
      dbName: 'htos-db',
      dbVersion: 1,
      debug: false,
      timeout: 30000,
      autoCleanup: true,
      cleanupInterval: 24 * 60 * 60 * 1000, // 24 hours
      ...(config || {})
    };

    try {
      this.db = await openDatabase();
      
      // Runtime assertions - verify DB is properly opened
      if (!this.db) {
        console.error('persistence:init - Database failed to open');
        throw new Error('IndexedDB failed to open - database is null');
      }
      
      // Verify required object stores exist
      const requiredStores = ['sessions', 'threads', 'turns', 'provider_responses', 'documents', 'canvas_blocks', 'ghosts', 'provider_contexts', 'metadata'];
      const missingStores = requiredStores.filter(storeName => !this.db!.objectStoreNames.contains(storeName));
      
      if (missingStores.length > 0) {
        console.error('persistence:init - Missing required object stores:', missingStores);
        throw new Error(`IndexedDB missing required object stores: ${missingStores.join(', ')}`);
      }
      
      this.repositories = createRepositories(this.db);

      if (this.config.autoCleanup) {
        this.startCleanupInterval();
      }

      this.emit('ready');
      
      console.warn('persistence adapter initialized');
      if (this.config.debug) {
        console.log('[IndexedDBAdapter] Initialized successfully');
      }
    } catch (error) {
      console.error('persistence:init - Initialization failed:', error);
      this.emit('error', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    if (this.db) {
      this.db.close();
      this.db = null;
      this.repositories = null;
    }

    this.emit('close');
  }

  isReady(): boolean {
    return this.db !== null && this.repositories !== null;
  }

  async getHealth(): Promise<HealthStatus> {
    if (!this.db) {
      return {
        healthy: false,
        connected: false,
        errors: ['Database not initialized']
      };
    }

    try {
      const dbHealth = await checkDatabaseHealth();
      const avgResponseTime = this.metrics.responseTimes.length > 0
        ? this.metrics.responseTimes.reduce((a, b) => a + b, 0) / this.metrics.responseTimes.length
        : 0;

      return {
        healthy: dbHealth.isHealthy,
        connected: true,
        lastActivity: Date.now(),
        metrics: {
          avgResponseTime,
          totalOperations: this.metrics.totalOperations,
          errorRate: this.metrics.totalOperations > 0 
            ? this.metrics.errorCount / this.metrics.totalOperations 
            : 0
        }
      };
    } catch (error) {
      return {
        healthy: false,
        connected: false,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      };
    }
  }

  // Session operations
  async createSession(session: Omit<SessionRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<SessionRecord> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const id = crypto.randomUUID();
      const now = Date.now();
      const fullSession: SessionRecord = {
        ...session,
        id,
        createdAt: now,
        updatedAt: now
      };
      await this.repositories!.sessions.add(fullSession);
      return fullSession;
    });
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.sessions.get(id);
    });
  }

  async updateSession(id: string, updates: Partial<SessionRecord>): Promise<SessionRecord> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const existing = await this.repositories!.sessions.get(id);
      if (!existing) {
        throw new Error(`Session ${id} not found`);
      }
      const updated = {
        ...existing,
        ...updates,
        updatedAt: Date.now()
      };
      await this.repositories!.sessions.put(updated);
      return updated;
    });
  }

  async deleteSession(id: string): Promise<boolean> {
    return this.withMetrics(async () => {
      this.ensureReady();
      await this.repositories!.sessions.delete(id);
      return true;
    });
  }

  async listSessions(options: QueryOptions = {}): Promise<SessionRecord[]> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.sessions.getAll();
    });
  }

  async getSessionsByUserId(userId: string, options: QueryOptions = {}): Promise<SessionRecord[]> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.sessions.getByUserId(userId);
    });
  }

  // Thread operations
  async createThread(thread: Omit<ThreadRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ThreadRecord> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const id = crypto.randomUUID();
      const now = Date.now();
      const fullThread: ThreadRecord = {
        ...thread,
        id,
        createdAt: now,
        updatedAt: now
      };
      await this.repositories!.threads.add(fullThread);
      return fullThread;
    });
  }

  async getThread(id: string): Promise<ThreadRecord | null> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.threads.get(id);
    });
  }

  async updateThread(id: string, updates: Partial<ThreadRecord>): Promise<ThreadRecord> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const existing = await this.repositories!.threads.get(id);
      if (!existing) {
        throw new Error(`Thread ${id} not found`);
      }
      const updated = {
        ...existing,
        ...updates,
        updatedAt: Date.now()
      };
      await this.repositories!.threads.put(updated);
      return updated;
    });
  }

  async deleteThread(id: string): Promise<boolean> {
    return this.withMetrics(async () => {
      this.ensureReady();
      await this.repositories!.threads.delete(id);
      return true;
    });
  }

  async listThreads(options: QueryOptions = {}): Promise<ThreadRecord[]> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.threads.getAll();
    });
  }

  async getThreadsBySessionId(sessionId: string, options: QueryOptions = {}): Promise<ThreadRecord[]> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.threads.getBySessionId(sessionId);
    });
  }

  // Turn operations
  async createTurn(turn: Omit<TurnRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<TurnRecord> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const id = crypto.randomUUID();
      const now = Date.now();
      
      // Handle the union type properly by checking the type field
      let fullTurn: TurnRecord;
      if (turn.type === 'user') {
        fullTurn = {
          ...turn,
          id,
          createdAt: now,
          updatedAt: now
        } as UserTurnRecord;
      } else if (turn.type === 'ai') {
        // Ensure AI turn has required properties
        const aiTurn = turn as Omit<AiTurnRecord, 'id' | 'createdAt' | 'updatedAt'>;
        fullTurn = {
          ...aiTurn,
          id,
          createdAt: now,
          updatedAt: now,
          // Provide defaults for required AI turn properties if missing
          userTurnId: aiTurn.userTurnId || '',
          batchResponseCount: aiTurn.batchResponseCount || 0,
          synthesisResponseCount: aiTurn.synthesisResponseCount || 0,
          mappingResponseCount: aiTurn.mappingResponseCount || 0
        } as AiTurnRecord;
      } else {
        throw new Error(`Invalid turn type: ${(turn as any).type}`);
      }
      
      await this.repositories!.turns.add(fullTurn);
      return fullTurn;
    });
  }

  async getTurn(id: string): Promise<TurnRecord | null> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.turns.get(id);
    });
  }

  async updateTurn(id: string, updates: Partial<TurnRecord>): Promise<TurnRecord> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const existing = await this.repositories!.turns.get(id);
      if (!existing) {
        throw new Error(`Turn ${id} not found`);
      }
      const updated: TurnRecord = {
        ...existing,
        ...updates,
        updatedAt: Date.now()
      } as TurnRecord;
      await this.repositories!.turns.put(updated);
      return updated;
    });
  }

  async deleteTurn(id: string): Promise<boolean> {
    return this.withMetrics(async () => {
      this.ensureReady();
      await this.repositories!.turns.delete(id);
      return true;
    });
  }

  async listTurns(options: QueryOptions = {}): Promise<TurnRecord[]> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.turns.getAll();
    });
  }

  async getTurnsByThreadId(threadId: string, options: QueryOptions = {}): Promise<TurnRecord[]> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.turns.getByThreadId(threadId);
    });
  }

  // Provider Response operations
  async createProviderResponse(response: Omit<ProviderResponseRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProviderResponseRecord> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const id = crypto.randomUUID();
      const now = Date.now();
      const fullResponse: ProviderResponseRecord = {
        ...response,
        id,
        createdAt: now,
        updatedAt: now
      };
      await this.repositories!.providerResponses.add(fullResponse);
      return fullResponse;
    });
  }

  async getProviderResponse(id: string): Promise<ProviderResponseRecord | null> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.providerResponses.get(id);
    });
  }

  async updateProviderResponse(id: string, updates: Partial<ProviderResponseRecord>): Promise<ProviderResponseRecord> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const existing = await this.repositories!.providerResponses.get(id);
      if (!existing) {
        throw new Error(`Provider response ${id} not found`);
      }
      const updated = {
        ...existing,
        ...updates,
        updatedAt: Date.now()
      };
      await this.repositories!.providerResponses.put(updated);
      return updated;
    });
  }

  async deleteProviderResponse(id: string): Promise<boolean> {
    return this.withMetrics(async () => {
      this.ensureReady();
      await this.repositories!.providerResponses.delete(id);
      return true;
    });
  }

  async listProviderResponses(options: QueryOptions = {}): Promise<ProviderResponseRecord[]> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.providerResponses.getAll();
    });
  }

  async getProviderResponsesByTurnId(turnId: string, options: QueryOptions = {}): Promise<ProviderResponseRecord[]> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.providerResponses.getByTurnId(turnId);
    });
  }

  // Document operations
  async createDocument(document: Omit<DocumentRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<DocumentRecord> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const id = crypto.randomUUID();
      const now = Date.now();
      const fullDocument: DocumentRecord = {
        ...document,
        id,
        createdAt: now,
        updatedAt: now
      };
      await this.repositories!.documents.add(fullDocument);
      return fullDocument;
    });
  }

  async getDocument(id: string): Promise<DocumentRecord | null> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.documents.get(id);
    });
  }

  async updateDocument(id: string, updates: Partial<DocumentRecord>): Promise<DocumentRecord> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const existing = await this.repositories!.documents.get(id);
      if (!existing) {
        throw new Error(`Document ${id} not found`);
      }
      const updated = {
        ...existing,
        ...updates,
        updatedAt: Date.now()
      };
      await this.repositories!.documents.put(updated);
      return updated;
    });
  }

  async deleteDocument(id: string): Promise<boolean> {
    return this.withMetrics(async () => {
      this.ensureReady();
      await this.repositories!.documents.delete(id);
      return true;
    });
  }

  async listDocuments(options: QueryOptions = {}): Promise<DocumentRecord[]> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.documents.getAll();
    });
  }

  async getDocumentsBySessionId(sessionId: string, options: QueryOptions = {}): Promise<DocumentRecord[]> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.documents.getBySessionId(sessionId);
    });
  }

  // Canvas Block operations
  async createCanvasBlock(block: Omit<CanvasBlockRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<CanvasBlockRecord> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const id = crypto.randomUUID();
      const now = Date.now();
      const fullBlock: CanvasBlockRecord = {
        ...block,
        id,
        createdAt: now,
        updatedAt: now
      };
      await this.repositories!.canvasBlocks.add(fullBlock);
      return fullBlock;
    });
  }

  async getCanvasBlock(id: string): Promise<CanvasBlockRecord | null> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.canvasBlocks.get(id);
    });
  }

  async updateCanvasBlock(id: string, updates: Partial<CanvasBlockRecord>): Promise<CanvasBlockRecord> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const existing = await this.repositories!.canvasBlocks.get(id);
      if (!existing) {
        throw new Error(`Canvas block ${id} not found`);
      }
      const updated = {
        ...existing,
        ...updates,
        updatedAt: Date.now()
      };
      await this.repositories!.canvasBlocks.put(updated);
      return updated;
    });
  }

  async deleteCanvasBlock(id: string): Promise<boolean> {
    return this.withMetrics(async () => {
      this.ensureReady();
      await this.repositories!.canvasBlocks.delete(id);
      return true;
    });
  }

  async listCanvasBlocks(options: QueryOptions = {}): Promise<CanvasBlockRecord[]> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.canvasBlocks.getAll();
    });
  }

  async getCanvasBlocksByDocumentId(documentId: string, options: QueryOptions = {}): Promise<CanvasBlockRecord[]> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.canvasBlocks.getByDocumentId(documentId);
    });
  }

  // Ghost operations
  async createGhost(ghost: Omit<GhostRecord, 'id' | 'createdAt'>): Promise<GhostRecord> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const id = crypto.randomUUID();
      const fullGhost: GhostRecord = {
        ...ghost,
        id,
        createdAt: Date.now()
      };
      await this.repositories!.ghosts.add(fullGhost);
      return fullGhost;
    });
  }

  async getGhost(id: string): Promise<GhostRecord | null> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.ghosts.get(id);
    });
  }

  async deleteGhost(id: string): Promise<boolean> {
    return this.withMetrics(async () => {
      this.ensureReady();
      await this.repositories!.ghosts.delete(id);
      return true;
    });
  }

  async listGhosts(options: QueryOptions = {}): Promise<GhostRecord[]> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.ghosts.getAll();
    });
  }

  async getGhostsByEntityId(entityId: string, options: QueryOptions = {}): Promise<GhostRecord[]> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.ghosts.getByEntityId(entityId);
    });
  }

  // Provider Context operations
  async createProviderContext(context: Omit<ProviderContextRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProviderContextRecord> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const id = crypto.randomUUID();
      const now = Date.now();
      const fullContext: ProviderContextRecord = {
        ...context,
        id,
        createdAt: now,
        updatedAt: now
      };
      await this.repositories!.providerContexts.add(fullContext);
      return fullContext;
    });
  }

  async getProviderContext(id: string): Promise<ProviderContextRecord | null> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.providerContexts.get(id);
    });
  }

  async updateProviderContext(id: string, updates: Partial<ProviderContextRecord>): Promise<ProviderContextRecord> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const existing = await this.repositories!.providerContexts.get(id);
      if (!existing) {
        throw new Error(`Provider context ${id} not found`);
      }
      const updated = {
        ...existing,
        ...updates,
        updatedAt: Date.now()
      };
      await this.repositories!.providerContexts.put(updated);
      return updated;
    });
  }

  async deleteProviderContext(id: string): Promise<boolean> {
    return this.withMetrics(async () => {
      this.ensureReady();
      await this.repositories!.providerContexts.delete(id);
      return true;
    });
  }

  async listProviderContexts(options: QueryOptions = {}): Promise<ProviderContextRecord[]> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.providerContexts.getAll();
    });
  }

  async getProviderContextsBySessionId(sessionId: string, options: QueryOptions = {}): Promise<ProviderContextRecord[]> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.providerContexts.getBySessionId(sessionId);
    });
  }

  // Metadata operations
  async createMetadata(metadata: Omit<MetadataRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<MetadataRecord> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const id = crypto.randomUUID();
      const now = Date.now();
      const fullMetadata: MetadataRecord = {
        ...metadata,
        id,
        createdAt: now,
        updatedAt: now
      };
      await this.repositories!.metadata.add(fullMetadata);
      return fullMetadata;
    });
  }

  async getMetadata(id: string): Promise<MetadataRecord | null> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.metadata.get(id);
    });
  }

  async updateMetadata(id: string, updates: Partial<MetadataRecord>): Promise<MetadataRecord> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const existing = await this.repositories!.metadata.get(id);
      if (!existing) {
        throw new Error(`Metadata ${id} not found`);
      }
      const updated = {
        ...existing,
        ...updates,
        updatedAt: Date.now()
      };
      await this.repositories!.metadata.put(updated);
      return updated;
    });
  }

  async deleteMetadata(id: string): Promise<boolean> {
    return this.withMetrics(async () => {
      this.ensureReady();
      await this.repositories!.metadata.delete(id);
      return true;
    });
  }

  async listMetadata(options: QueryOptions = {}): Promise<MetadataRecord[]> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.metadata.getAll();
    });
  }

  async getMetadataByEntityId(entityId: string, options: QueryOptions = {}): Promise<MetadataRecord[]> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return this.repositories!.metadata.getByEntityId(entityId);
    });
  }

  // Batch operations
  async batchCreate<T>(storeName: string, records: T[]): Promise<BatchResult<T>> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const success: T[] = [];
      const errors: Array<{ record: T; error: Error }> = [];

      for (const record of records) {
        try {
          const store = this.db!.transaction([storeName], 'readwrite').objectStore(storeName);
          await new Promise<void>((resolve, reject) => {
            const request = store.add(record);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
          });
          success.push(record);
        } catch (error) {
          errors.push({ record, error: error as Error });
        }
      }

      return { success, errors, total: records.length };
    });
  }

  async batchUpdate<T>(storeName: string, updates: Array<{ id: string; data: Partial<T> }>): Promise<BatchResult<T>> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const success: T[] = [];
      const errors: Array<{ record: T; error: Error }> = [];

      for (const update of updates) {
        try {
          const store = this.db!.transaction([storeName], 'readwrite').objectStore(storeName);
          const existing = await new Promise<T>((resolve, reject) => {
            const request = store.get(update.id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });

          if (!existing) {
            throw new Error(`Record ${update.id} not found`);
          }

          const updated = { ...existing, ...update.data };
          await new Promise<void>((resolve, reject) => {
            const request = store.put(updated);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
          });

          success.push(updated);
        } catch (error) {
          errors.push({ record: update.data as T, error: error as Error });
        }
      }

      return { success, errors, total: updates.length };
    });
  }

  async batchDelete(storeName: string, ids: string[]): Promise<BatchResult<string>> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const success: string[] = [];
      const errors: Array<{ record: string; error: Error }> = [];

      for (const id of ids) {
        try {
          const store = this.db!.transaction([storeName], 'readwrite').objectStore(storeName);
          await new Promise<void>((resolve, reject) => {
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
          });
          success.push(id);
        } catch (error) {
          errors.push({ record: id, error: error as Error });
        }
      }

      return { success, errors, total: ids.length };
    });
  }

  // Transaction operations
  async transaction<T>(
    storeNames: string[],
    mode: 'readonly' | 'readwrite',
    operation: (tx: IDBTransaction) => Promise<T>
  ): Promise<T> {
    return this.withMetrics(async () => {
      this.ensureReady();
      return withTransaction(this.db!, storeNames, mode, operation);
    });
  }

  private resolveStoreName(name: string): string {
    const map: Record<string, string> = {
      providerResponses: 'provider_responses',
      canvasBlocks: 'canvas_blocks',
      providerContexts: 'provider_contexts',
    };
    return map[name] || name;
  }

  // Utility operations
  async count(storeName: string, query?: IDBValidKey | IDBKeyRange): Promise<number> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const resolved = this.resolveStoreName(storeName);
      const store = this.db!.transaction([resolved], 'readonly').objectStore(resolved);
      return new Promise<number>((resolve, reject) => {
        const request = query ? store.count(query) : store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    });
  }

  async clear(storeName: string): Promise<void> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const resolved = this.resolveStoreName(storeName);
      const store = this.db!.transaction([resolved], 'readwrite').objectStore(resolved);
      return new Promise<void>((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });
  }

  // Compatibility shims for SimpleIndexedDBAdapter-style methods
  async get(storeName: string, key: IDBValidKey): Promise<any | null> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const resolved = this.resolveStoreName(storeName);
      const store = this.db!.transaction([resolved], 'readonly').objectStore(resolved);
      return new Promise<any | null>((resolve, reject) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    });
  }

  async getAll(storeName: string): Promise<any[]> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const resolved = this.resolveStoreName(storeName);
      const store = this.db!.transaction([resolved], 'readonly').objectStore(resolved);
      return new Promise<any[]>((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    });
  }

  async put(storeName: string, record: any): Promise<void> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const resolved = this.resolveStoreName(storeName);
      const store = this.db!.transaction([resolved], 'readwrite').objectStore(resolved);
      return new Promise<void>((resolve, reject) => {
        const request = store.put(record);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });
  }

  async delete(storeName: string, key: IDBValidKey): Promise<void> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const resolved = this.resolveStoreName(storeName);
      const store = this.db!.transaction([resolved], 'readwrite').objectStore(resolved);
      return new Promise<void>((resolve, reject) => {
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    });
  }

  async export(): Promise<Record<string, any[]>> {
    return this.withMetrics(async () => {
      this.ensureReady();
      const data: Record<string, any[]> = {};
      const storeNames = ['sessions', 'threads', 'turns', 'provider_responses', 'documents', 'canvas_blocks', 'ghosts', 'provider_contexts', 'metadata'];

      for (const storeName of storeNames) {
        const resolved = this.resolveStoreName(storeName);
        const store = this.db!.transaction([resolved], 'readonly').objectStore(resolved);
        data[storeName] = await new Promise<any[]>((resolve, reject) => {
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }

      return data;
    });
  }

  async import(data: Record<string, any[]>): Promise<void> {
    return this.withMetrics(async () => {
      this.ensureReady();
      
      for (const [storeName, records] of Object.entries(data)) {
        if (records && records.length > 0) {
          const resolved = this.resolveStoreName(storeName);
          await this.batchCreate(resolved, records);
        }
      }
    });
  }

  // Event handling
  on(event: 'ready' | 'error' | 'close', handler: (data?: any) => void): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.add(handler);
    }
  }

  off(event: 'ready' | 'error' | 'close', handler: (data?: any) => void): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  // Private helper methods
  private ensureReady(): void {
    if (!this.isReady()) {
      throw new Error('IndexedDBAdapter is not initialized. Call initialize() first.');
    }
  }

  private emit(event: string, data?: any): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }

  private async withMetrics<T>(operation: () => Promise<T>): Promise<T> {
    const startTime = performance.now();
    this.metrics.totalOperations++;

    try {
      const result = await operation();
      const duration = performance.now() - startTime;
      this.metrics.responseTimes.push(duration);
      
      // Keep only last 100 response times for memory efficiency
      if (this.metrics.responseTimes.length > 100) {
        this.metrics.responseTimes = this.metrics.responseTimes.slice(-100);
      }

      return result;
    } catch (error) {
      this.metrics.errorCount++;
      throw error;
    }
  }

  private startCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.cleanupInterval = setInterval(async () => {
      try {
        if (this.repositories) {
          // Cleanup old sessions (older than 30 days)
          await this.repositories.sessions.cleanupOldSessions(30);
          
          // Cleanup old turns (older than 90 days) - need to get all threads and clean each
          const allThreads = await this.repositories.threads.getAll();
          const cutoffDate = new Date(Date.now() - (90 * 24 * 60 * 60 * 1000));
          for (const thread of allThreads) {
            await this.repositories.turns.deleteOldTurns(thread.id, cutoffDate);
          }
          
          // Cleanup failed provider responses (older than 7 days)
          await this.repositories.providerResponses.cleanupFailedResponses(7);
          
          // Cleanup old ghosts (older than 60 days)
          await this.repositories.ghosts.cleanupOldGhosts(60);
          
          // Cleanup orphaned metadata - need to collect valid entity IDs
          const validEntityIds = new Set<string>();
          const sessions = await this.repositories.sessions.getAll();
          const threads = await this.repositories.threads.getAll();
          const turns = await this.repositories.turns.getAll();
          const documents = await this.repositories.documents.getAll();
          
          sessions.forEach(s => validEntityIds.add(s.id));
          threads.forEach(t => validEntityIds.add(t.id));
          turns.forEach(t => validEntityIds.add(t.id));
          documents.forEach(d => validEntityIds.add(d.id));
          
          await this.repositories.metadata.cleanupOrphanedMetadata(validEntityIds);
        }
      } catch (error) {
        console.error('Error during cleanup:', error);
      }
    }, this.config.cleanupInterval);
  }
}