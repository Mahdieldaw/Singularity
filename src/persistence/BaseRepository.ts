// Base Repository Class for IndexedDB Operations

import { withTransaction, promisifyRequest, batchWrite, batchDelete } from './transactions';
import { BatchWriteResult } from './types';

/**
 * Abstract base repository class providing common CRUD operations
 */
export abstract class BaseRepository<T> {
  protected db: IDBDatabase;
  protected storeName: string;

  constructor(db: IDBDatabase, storeName: string) {
    this.db = db;
    this.storeName = storeName;
  }

  /**
   * Get a single record by its primary key
   */
  async get(id: string | string[] | number): Promise<T | null> {
    return withTransaction(this.db, this.storeName, 'readonly', async (tx) => {
      const store = tx.objectStore(this.storeName);
      const request = store.get(id as IDBValidKey);
      const result = await promisifyRequest(request);
      return result || null;
    });
  }

  /**
   * Get multiple records by their primary keys
   */
  async getMany(ids: (string | string[] | number)[]): Promise<(T | null)[]> {
    if (ids.length === 0) {
      return [];
    }

    return withTransaction(this.db, this.storeName, 'readonly', async (tx) => {
      const store = tx.objectStore(this.storeName);
      
      const promises = ids.map(async (id) => {
        const request = store.get(id as IDBValidKey);
        const result = await promisifyRequest(request);
        return result || null;
      });

      return Promise.all(promises);
    });
  }

  /**
   * Get all records in the store
   */
  async getAll(): Promise<T[]> {
    return withTransaction(this.db, this.storeName, 'readonly', async (tx) => {
      const store = tx.objectStore(this.storeName);
      const request = store.getAll();
      return promisifyRequest(request);
    });
  }

  /**
   * Put (insert or update) a single record
   */
  async put(record: T): Promise<void> {
    return withTransaction(this.db, this.storeName, 'readwrite', async (tx) => {
      const store = tx.objectStore(this.storeName);
      const request = store.put(record);
      await promisifyRequest(request);
    });
  }

  /**
   * Add a new record (will fail if key already exists)
   */
  async add(record: T): Promise<void> {
    return withTransaction(this.db, this.storeName, 'readwrite', async (tx) => {
      const store = tx.objectStore(this.storeName);
      const request = store.add(record);
      await promisifyRequest(request);
    });
  }

  /**
   * Delete a record by its primary key
   */
  async delete(id: string | string[] | number): Promise<void> {
    return withTransaction(this.db, this.storeName, 'readwrite', async (tx) => {
      const store = tx.objectStore(this.storeName);
      const request = store.delete(id as IDBValidKey);
      await promisifyRequest(request);
    });
  }

  /**
   * Delete multiple records by their primary keys
   */
  async deleteMany(ids: (string | string[] | number)[]): Promise<BatchWriteResult> {
    return batchDelete(this.db, this.storeName, ids);
  }

  /**
   * Clear all records from the store
   */
  async clear(): Promise<void> {
    return withTransaction(this.db, this.storeName, 'readwrite', async (tx) => {
      const store = tx.objectStore(this.storeName);
      const request = store.clear();
      await promisifyRequest(request);
    });
  }

  /**
   * Count all records in the store
   */
  async count(): Promise<number> {
    return withTransaction(this.db, this.storeName, 'readonly', async (tx) => {
      const store = tx.objectStore(this.storeName);
      const request = store.count();
      return promisifyRequest(request);
    });
  }

  /**
   * Batch write multiple records
   */
  async putMany(records: T[]): Promise<BatchWriteResult> {
    return batchWrite(this.db, this.storeName, records);
  }

  /**
   * Check if a record exists by its primary key
   */
  async exists(id: string | string[] | number): Promise<boolean> {
    return withTransaction(this.db, this.storeName, 'readonly', async (tx) => {
      const store = tx.objectStore(this.storeName);
      const request = store.getKey(id as IDBValidKey);
      const result = await promisifyRequest(request);
      return result !== undefined;
    });
  }

  /**
   * Get records by index with optional key range
   */
  protected async getByIndex(
    indexName: string,
    key?: IDBValidKey | IDBKeyRange,
    limit?: number
  ): Promise<T[]> {
    return withTransaction(this.db, this.storeName, 'readonly', async (tx) => {
      const store = tx.objectStore(this.storeName);
      const index = store.index(indexName);
      
      if (limit) {
        // Use cursor for limited results
        const results: T[] = [];
        const request = index.openCursor(key);
        
        return new Promise((resolve, reject) => {
          request.onsuccess = () => {
            const cursor = request.result;
            if (cursor && results.length < limit) {
              results.push(cursor.value);
              cursor.continue();
            } else {
              resolve(results);
            }
          };
          request.onerror = () => reject(request.error);
        });
      } else {
        // Get all matching records
        const request = index.getAll(key);
        return promisifyRequest(request);
      }
    });
  }

  /**
   * Get a single record by index
   */
  protected async getOneByIndex(
    indexName: string,
    key: IDBValidKey | IDBKeyRange
  ): Promise<T | null> {
    return withTransaction(this.db, this.storeName, 'readonly', async (tx) => {
      const store = tx.objectStore(this.storeName);
      const index = store.index(indexName);
      const request = index.get(key);
      const result = await promisifyRequest(request);
      return result || null;
    });
  }

  /**
   * Count records by index
   */
  protected async countByIndex(
    indexName: string,
    key?: IDBValidKey | IDBKeyRange
  ): Promise<number> {
    return withTransaction(this.db, this.storeName, 'readonly', async (tx) => {
      const store = tx.objectStore(this.storeName);
      const index = store.index(indexName);
      const request = index.count(key);
      return promisifyRequest(request);
    });
  }

  /**
   * Get all keys from an index
   */
  protected async getKeysByIndex(
    indexName: string,
    key?: IDBValidKey | IDBKeyRange,
    limit?: number
  ): Promise<IDBValidKey[]> {
    return withTransaction(this.db, this.storeName, 'readonly', async (tx) => {
      const store = tx.objectStore(this.storeName);
      const index = store.index(indexName);
      
      if (limit) {
        // Use cursor for limited results
        const results: IDBValidKey[] = [];
        const request = index.openKeyCursor(key);
        
        return new Promise((resolve, reject) => {
          request.onsuccess = () => {
            const cursor = request.result;
            if (cursor && results.length < limit) {
              results.push(cursor.primaryKey);
              cursor.continue();
            } else {
              resolve(results);
            }
          };
          request.onerror = () => reject(request.error);
        });
      } else {
        // Get all matching keys
        const request = index.getAllKeys(key);
        return promisifyRequest(request);
      }
    });
  }

  /**
   * Execute a custom cursor operation
   */
  protected async withCursor<R>(
    indexName: string | null,
    key: IDBValidKey | IDBKeyRange | undefined,
    direction: IDBCursorDirection,
    processor: (cursor: IDBCursorWithValue) => R | Promise<R>
  ): Promise<R[]> {
    return withTransaction(this.db, this.storeName, 'readonly', async (tx) => {
      const store = tx.objectStore(this.storeName);
      const source = indexName ? store.index(indexName) : store;
      const request = source.openCursor(key, direction);
      
      const results: R[] = [];
      
      return new Promise((resolve, reject) => {
        request.onsuccess = async () => {
          const cursor = request.result;
          if (cursor) {
            try {
              const result = await processor(cursor);
              results.push(result);
              cursor.continue();
            } catch (error) {
              reject(error);
            }
          } else {
            resolve(results);
          }
        };
        request.onerror = () => reject(request.error);
      });
    });
  }

  /**
   * Get records with pagination support
   */
  async getPaginated(
    indexName?: string,
    key?: IDBValidKey | IDBKeyRange,
    offset: number = 0,
    limit: number = 50
  ): Promise<{ records: T[]; hasMore: boolean; total?: number }> {
    return withTransaction(this.db, this.storeName, 'readonly', async (tx) => {
      const store = tx.objectStore(this.storeName);
      const source = indexName ? store.index(indexName) : store;
      
      // Get total count if no key specified (for first page)
      let total: number | undefined;
      if (offset === 0 && !key) {
        const countRequest = source.count();
        total = await promisifyRequest(countRequest);
      }
      
      // Get paginated results
      const records: T[] = [];
      let skipped = 0;
      let collected = 0;
      
      const request = source.openCursor(key);
      
      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            if (skipped < offset) {
              skipped++;
              cursor.continue();
            } else if (collected < limit) {
              records.push(cursor.value);
              collected++;
              cursor.continue();
            } else {
              // We have one more record, so there are more pages
              resolve({
                records,
                hasMore: true,
                total
              });
            }
          } else {
            // No more records
            resolve({
              records,
              hasMore: false,
              total
            });
          }
        };
        request.onerror = () => reject(request.error);
      });
    });
  }
}