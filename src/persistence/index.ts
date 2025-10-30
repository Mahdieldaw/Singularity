// Main persistence layer exports
// Provides a single entry point for all persistence-related functionality

// Core types
export * from './types';

// Database and transactions
export * from './database.js';
export * from './transactions.js';

// Base repository
export * from './BaseRepository.js';

// Repositories
export * from './repositories/index.js';

// Adapters
export * from './adapters/index.js';

// Query helpers
export * from './queries/index.js';

// Document manager
export * from './DocumentManager.js';

// Session manager
export * from './SessionManager.js';

// Factory functions for easy setup
import { openDatabase, STORE_CONFIGS, SCHEMA_VERSION } from './database.js';
import { createPersistenceAdapter } from './adapters/index.js';
import { createRepositories } from './repositories/index.js';
import { createProvenanceQueries } from './queries/index.js';
import { createDocumentManager } from './DocumentManager.js';
import type { IPersistenceAdapter } from './adapters/IPersistenceAdapter.js';
import type { RepositoryCollection } from './repositories/index.js';
import type { DocumentManagerConfig } from './DocumentManager.js';

/**
 * Complete persistence layer setup
 */
export interface PersistenceLayer {
  adapter: IPersistenceAdapter;
  repositories: RepositoryCollection;
  provenanceQueries: any;
  documentManager: any;
  close: () => Promise<void>;
}

/**
 * Initialize the complete persistence layer
 */
export async function initializePersistenceLayer(
  documentManagerConfig?: DocumentManagerConfig
): Promise<PersistenceLayer> {
  // Open database
  const db = await openDatabase();
  
  // Verify schema stores exist
  const storeNames = Array.from(db.objectStoreNames);
  const expectedStores = STORE_CONFIGS.map(cfg => cfg.name);
  const missingStores = expectedStores.filter(name => !storeNames.includes(name));
  if (missingStores.length > 0) {
    db.close();
    throw new Error(`SchemaError: Missing object stores: ${missingStores.join(', ')}`);
  }
  
  // Verify schema version metadata
  try {
    const tx = db.transaction('metadata', 'readonly');
    const store = tx.objectStore('metadata');
    const versionReq = store.get('schema_version');
    const version: number = await new Promise((resolve, reject) => {
      versionReq.onsuccess = () => resolve((versionReq.result && versionReq.result.value) || 0);
      versionReq.onerror = () => reject(versionReq.error);
    });
    if (version !== SCHEMA_VERSION) {
      db.close();
      throw new Error(`SchemaError: schema_version mismatch (current=${version}, expected=${SCHEMA_VERSION})`);
    }
  } catch (e) {
    db.close();
    throw new Error(`SchemaError: unable to read metadata schema_version: ${e instanceof Error ? e.message : String(e)}`);
  }
  
  // Create adapter
  const adapter = createPersistenceAdapter('indexeddb');
  // Disable adapter's internal auto-cleanup; we manage cleanup centrally in sw-entry.js
  await adapter.initialize({ autoCleanup: false });
  
  // Create repositories
  const repositories = createRepositories(db);
  
  // Create query helpers using the adapter (refactored)
  const provenanceQueries = createProvenanceQueries(adapter);

  // Create document manager using the adapter (refactored)
  const documentManager = createDocumentManager(adapter as any, documentManagerConfig);
  
  return {
    adapter,
    repositories,
    provenanceQueries,
    documentManager,
    close: async () => {
      documentManager.dispose();
      await adapter.close();
      db.close();
    }
  };
}

/**
 * Feature flag for persistence layer
 */
export const PERSISTENCE_FEATURE_FLAGS = {
  USE_PERSISTENCE_ADAPTER: false,
  ENABLE_AUTO_DECOMPOSITION: true,
  ENABLE_AUTO_SAVE: true,
  ENABLE_PROVENANCE_TRACKING: true,
  ENABLE_GHOST_RAIL: true
} as const;

/**
 * Check if persistence layer is available
 */
export function isPersistenceAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && 
         typeof IDBDatabase !== 'undefined';
}

/**
 * Get persistence layer health status
 */
export async function getPersistenceHealth(): Promise<{
  available: boolean;
  adapterReady: boolean;
  databaseOpen: boolean;
  error?: string;
}> {
  try {
    const available = isPersistenceAvailable();
    if (!available) {
      return {
        available: false,
        adapterReady: false,
        databaseOpen: false,
        error: 'IndexedDB not available'
      };
    }

    // Try to open database
    const db = await openDatabase();
    
    // Check if database is ready by attempting to create a transaction
    let databaseOpen = false;
    try {
      const tx = db.transaction(['sessions'], 'readonly');
      databaseOpen = tx !== null;
    } catch (error) {
      databaseOpen = false;
    }
    
    // Create adapter and check readiness
    const adapter = createPersistenceAdapter('indexeddb');
    await adapter.initialize();
    const adapterReady = await adapter.isReady();
    
    // Cleanup
    await adapter.close();
    db.close();
    
    return {
      available: true,
      adapterReady,
      databaseOpen,
    };
  } catch (error) {
    return {
      available: false,
      adapterReady: false,
      databaseOpen: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}