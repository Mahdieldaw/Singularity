// Simplified IndexedDB Adapter with minimal API for HTOS persistence
// Provides init(), get(), put(), delete(), getAll() methods with auto-population of key fields

import { openDatabase } from './database';
import { verifySchemaAndRepair } from './schemaVerification';
import { withTransaction } from './transactions';

export interface SimpleRecord {
  id?: string;
  createdAt?: number;
  updatedAt?: number;
  [key: string]: any;
}

/**
 * Simplified IndexedDB adapter with minimal API surface
 */
export class SimpleIndexedDBAdapter {
  private db: IDBDatabase | null = null;
  private isInitialized = false;
  private initTimeoutMs = 8000;

  /**
   * Initialize the adapter and open the database
   * Only returns after onupgradeneeded completes and DB is fully open
   */
  async init(options?: { timeoutMs?: number; autoRepair?: boolean }): Promise<void> {
    console.warn('persistence:init - Starting SimpleIndexedDBAdapter initialization');
    this.initTimeoutMs = options?.timeoutMs ?? this.initTimeoutMs;
    const autoRepair = options?.autoRepair ?? true;

    try {
      // Open DB with timeout protection
      const dbPromise = openDatabase();
      this.db = await this.withTimeout(dbPromise, this.initTimeoutMs, 'Timeout opening IndexedDB database');
      
      // Runtime assertions - verify DB is properly opened
      if (!this.db) {
        console.error('persistence:init - Database failed to open');
        throw new Error('IndexedDB failed to open - database is null');
      }
      
      // Verify/repair schema if needed
      const { repaired, db: repairedDb } = await verifySchemaAndRepair(autoRepair);
      if (repaired && repairedDb) {
        // Replace db handle with repaired instance
        this.db = repairedDb;
      }
      if (!repaired) {
        // verify required object stores exist if no repair was needed
        const requiredStores = ['sessions', 'threads', 'turns', 'provider_responses', 'documents', 'canvas_blocks', 'ghosts', 'provider_contexts', 'metadata'];
        const missingStores = requiredStores.filter(storeName => !this.db!.objectStoreNames.contains(storeName));
        if (missingStores.length > 0) {
          console.error('persistence:init - Missing required object stores:', missingStores);
          throw new Error(`IndexedDB missing required object stores: ${missingStores.join(', ')}`);
        }
      }
      
      this.isInitialized = true;
      console.warn('persistence adapter initialized');
    } catch (error) {
      console.error('persistence:init - Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Get a record by key from the specified store
   * Returns undefined if record is not found (safe behavior)
   */
  async get(storeName: string, key: string): Promise<SimpleRecord | undefined> {
    this.ensureReady();
    const resolved = this.resolveStoreName(storeName);
    try {
      const result = await withTransaction(this.db!, [resolved], 'readonly', async (tx) => {
        const store = tx.objectStore(resolved);
        return new Promise<SimpleRecord | undefined>((resolve, reject) => {
          const request = store.get(key);
          request.onsuccess = () => resolve(request.result || undefined);
          request.onerror = () => reject(request.error);
        });
      });
      
      console.log(`persistence:get(${resolved}, ${key}) - ${result ? 'found' : 'not found'}`);
      return result;
    } catch (error) {
      console.error(`persistence:get(${resolved}, ${key}) - error:`, error);
      throw error;
    }
  }

  /**
   * Put a record into the specified store
   * Auto-populates id, createdAt, updatedAt fields if missing
   */
  async put(storeName: string, value: SimpleRecord, key?: string): Promise<SimpleRecord> {
    this.ensureReady();
    const resolved = this.resolveStoreName(storeName);
    try {
      // Defensive deep-clone to prevent mutation issues
      const clonedValue = JSON.parse(JSON.stringify(value));
      
      // Auto-populate required fields
      const now = Date.now();
      if (!clonedValue.id && !key) {
        clonedValue.id = crypto.randomUUID();
      }
      if (key && !clonedValue.id) {
        clonedValue.id = key;
      }
      if (!clonedValue.createdAt) {
        clonedValue.createdAt = now;
      }
      clonedValue.updatedAt = now;
      
      const result = await withTransaction(this.db!, [resolved], 'readwrite', async (tx) => {
        const store = tx.objectStore(resolved);
        return new Promise<SimpleRecord>((resolve, reject) => {
          const request = key ? store.put(clonedValue, key) : store.put(clonedValue);
          request.onsuccess = () => resolve(clonedValue);
          request.onerror = () => reject(request.error);
        });
      });
      
      console.log(`persistence:put(${resolved}, ${clonedValue.id}) - success`);
      return result;
    } catch (error) {
      console.error(`persistence:put(${resolved}, ${key || value.id}) - error:`, error);
      throw error;
    }
  }

  /**
   * Delete a record by key from the specified store
   */
  async delete(storeName: string, key: string): Promise<boolean> {
    this.ensureReady();
    const resolved = this.resolveStoreName(storeName);
    try {
      await withTransaction(this.db!, [resolved], 'readwrite', async (tx) => {
        const store = tx.objectStore(resolved);
        return new Promise<void>((resolve, reject) => {
          const request = store.delete(key);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      });
      
      console.log(`persistence:delete(${resolved}, ${key}) - success`);
      return true;
    } catch (error) {
      console.error(`persistence:delete(${resolved}, ${key}) - error:`, error);
      throw error;
    }
  }

  /**
   * Get all records from the specified store
   * Returns empty array if no records found (safe behavior)
   */
  async getAll(storeName: string): Promise<SimpleRecord[]> {
    this.ensureReady();
    const resolved = this.resolveStoreName(storeName);
    try {
      const result = await withTransaction(this.db!, [resolved], 'readonly', async (tx) => {
        const store = tx.objectStore(resolved);
        return new Promise<SimpleRecord[]>((resolve, reject) => {
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
        });
      });
      
      console.log(`persistence:getAll(${resolved}) - found ${result.length} records`);
      return result;
    } catch (error) {
      console.error(`persistence:getAll(${resolved}) - error:`, error);
      throw error;
    }
  }

  /**
   * Check if the adapter is ready for use
   */
  isReady(): boolean {
    return this.isInitialized && this.db !== null;
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
    }
  }

  /**
   * Ensure the adapter is ready before operations
   */
  private ensureReady(): void {
    if (!this.isReady()) {
      throw new Error('SimpleIndexedDBAdapter is not initialized. Call init() first.');
    }
  }

  /**
   * Resolve canonical store name to actual IndexedDB object store name
   * Supports both camelCase and snake_case aliases
   */
  private resolveStoreName(name: string): string {
    const map: Record<string, string> = {
      providerResponses: 'provider_responses',
      canvasBlocks: 'canvas_blocks',
      providerContexts: 'provider_contexts'
    };
    return map[name] || name;
  }

  /**
   * Verifies the schema is healthy; if not and autoRepair=true, attempts delete-and-recreate.
   * Returns true if a repair was performed, false if no repair was needed.
   */
  // verifySchemaAndRepair extracted to standalone utility in schemaVerification.ts

  /**
   * Helper to add timeout to promises to avoid hanging initialization
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    let timeoutHandle: any;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });
    try {
      const result = await Promise.race([promise, timeoutPromise]);
      return result as T;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}