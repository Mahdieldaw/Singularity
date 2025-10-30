// IndexedDB Database Initialization for HTOS Document Composition System

import { StoreConfig, MetadataRecord } from './types';

export const DB_NAME = 'OpusDeusDB';
export const DB_VERSION = 1;
export const SCHEMA_VERSION = 1;

// Store configurations matching the schema specification
export const STORE_CONFIGS: StoreConfig[] = [
  // 1. Sessions Store
  {
    name: 'sessions',
    keyPath: 'id',
    indices: [
      { name: 'byCreatedAt', keyPath: 'createdAt', unique: false },
      { name: 'byLastActivity', keyPath: 'lastActivity', unique: false }
    ]
  },
  
  // 2. Threads Store
  {
    name: 'threads',
    keyPath: 'id',
    indices: [
      { name: 'bySessionId', keyPath: 'sessionId', unique: false },
      { name: 'byParentThreadId', keyPath: 'parentThreadId', unique: false },
      { name: 'bySessionId_createdAt', keyPath: ['sessionId', 'createdAt'], unique: false }
    ]
  },
  
  // 3. Turns Store
  {
    name: 'turns',
    keyPath: 'id',
    indices: [
      { name: 'bySessionId', keyPath: 'sessionId', unique: false },
      { name: 'byThreadId', keyPath: 'threadId', unique: false },
      { name: 'byType', keyPath: 'type', unique: false },
      { name: 'bySessionId_createdAt', keyPath: ['sessionId', 'createdAt'], unique: false },
      { name: 'byThreadId_createdAt', keyPath: ['threadId', 'createdAt'], unique: false },
      { name: 'byUserTurnId', keyPath: 'userTurnId', unique: false }
    ]
  },
  
  // 4. Provider Responses Store
  {
    name: 'provider_responses',
    keyPath: 'id',
    autoIncrement: true,
    indices: [
      { name: 'byAiTurnId', keyPath: 'aiTurnId', unique: false },
      { name: 'byProviderId', keyPath: 'providerId', unique: false },
      { name: 'byResponseType', keyPath: 'responseType', unique: false },
      { name: 'byCompoundKey', keyPath: ['aiTurnId', 'providerId', 'responseType', 'responseIndex'], unique: true },
      { name: 'bySessionId_providerId', keyPath: ['sessionId', 'providerId'], unique: false }
    ]
  },
  
  // 5. Documents Store
  {
    name: 'documents',
    keyPath: 'id',
    indices: [
      { name: 'byCreatedAt', keyPath: 'createdAt', unique: false },
      { name: 'byLastModified', keyPath: 'lastModified', unique: false },
      { name: 'bySourceSessionId', keyPath: 'sourceSessionId', unique: false }
    ]
  },
  
  // 6. Canvas Blocks Store
  {
    name: 'canvas_blocks',
    keyPath: 'id',
    indices: [
      { name: 'byDocumentId', keyPath: 'documentId', unique: false },
      { name: 'bySessionId', keyPath: 'provenance.sessionId', unique: false },
      { name: 'byAiTurnId', keyPath: 'provenance.aiTurnId', unique: false },
      { name: 'byProviderId', keyPath: 'provenance.providerId', unique: false },
      { name: 'byDocumentId_order', keyPath: ['documentId', 'order'], unique: true },
      { name: 'byUpdatedAt', keyPath: 'updatedAt', unique: false }
    ]
  },
  
  // 7. Ghosts Store
  {
    name: 'ghosts',
    keyPath: 'id',
    indices: [
      { name: 'byDocumentId', keyPath: 'documentId', unique: false },
      { name: 'bySessionId', keyPath: 'provenance.sessionId', unique: false },
      { name: 'byAiTurnId', keyPath: 'provenance.aiTurnId', unique: false },
      { name: 'byCreatedAt', keyPath: 'createdAt', unique: false }
    ]
  },
  
  // 8. Provider Contexts Store
  {
    name: 'provider_contexts',
    keyPath: ['sessionId', 'providerId'],
    indices: [
      { name: 'bySessionId', keyPath: 'sessionId', unique: false },
      { name: 'byProviderId', keyPath: 'providerId', unique: false }
    ]
  },
  
  // 9. Metadata Store
  {
    name: 'metadata',
    keyPath: 'key',
    indices: []
  }
];

/**
 * Opens the IndexedDB database with proper schema initialization
 */
export async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion;
      const transaction = (event.target as IDBOpenDBRequest).transaction!;
      
      console.log(`Upgrading database from version ${oldVersion} to ${DB_VERSION}`);
      
      if (oldVersion < 1) {
        // Initial schema creation
        createInitialSchema(db);
        
        // Set initial metadata
        const metadataStore = transaction.objectStore('metadata');
        const now = Date.now(); // Create a timestamp to use for both createdAt and updatedAt
        const schemaVersionRecord: MetadataRecord = {
          id: 'schema_version_record',
          key: 'schema_version',
          value: SCHEMA_VERSION,
          createdAt: now, // <-- ADD THIS LINE
          updatedAt: now
        };
        metadataStore.add(schemaVersionRecord);
      }
      
      // Future migrations would go here
      // if (oldVersion < 2) { ... }
    };
    
    request.onsuccess = () => {
      const db = request.result;
      
      // Handle database errors
      db.onerror = (event) => {
        console.error('Database error:', (event.target as IDBRequest).error);
      };
      
      // Handle version change (another tab upgraded the schema)
      db.onversionchange = () => {
        db.close();
        console.warn('Database schema was upgraded in another tab. Please reload.');
      };
      
      resolve(db);
    };
    
    request.onerror = () => {
      const error = request.error;
      console.error('Failed to open database:', error);
      
      if (error?.name === 'QuotaExceededError') {
        reject(new Error('Storage quota exceeded. Please free up space and try again.'));
      } else {
        reject(error);
      }
    };
    
    request.onblocked = () => {
      console.warn('Database upgrade blocked by another tab. Please close other tabs.');
    };
  });
}

/**
 * Creates the initial database schema with all stores and indices
 */
function createInitialSchema(db: IDBDatabase): void {
  console.log('Creating initial database schema...');
  
  for (const config of STORE_CONFIGS) {
    console.log(`Creating store: ${config.name}`);
    
    // Create object store
    const storeOptions: IDBObjectStoreParameters = {
      keyPath: config.keyPath
    };
    
    if (config.autoIncrement) {
      storeOptions.autoIncrement = true;
    }
    
    const store = db.createObjectStore(config.name, storeOptions);
    
    // Create indices
    for (const indexConfig of config.indices) {
      console.log(`  Creating index: ${indexConfig.name}`);
      
      const indexOptions: IDBIndexParameters = {
        unique: indexConfig.unique || false,
        multiEntry: indexConfig.multiEntry || false
      };
      
      store.createIndex(indexConfig.name, indexConfig.keyPath, indexOptions);
    }
  }
  
  console.log('Initial schema creation completed');
}

/**
 * Gets the current schema version from the metadata store
 */
export async function getCurrentSchemaVersion(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('metadata', 'readonly');
    const store = transaction.objectStore('metadata');
    const request = store.get('schema_version');
    
    request.onsuccess = () => {
      const record = request.result as MetadataRecord | undefined;
      resolve(record?.value || 0);
    };
    
    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Checks if the database needs to be upgraded
 */
export async function checkDatabaseHealth(): Promise<{
  isHealthy: boolean;
  currentVersion: number;
  expectedVersion: number;
  issues: string[];
}> {
  try {
    const db = await openDatabase();
    const currentVersion = await getCurrentSchemaVersion(db);
    const issues: string[] = [];
    
    // Check if all expected stores exist
    const storeNames = Array.from(db.objectStoreNames);
    const expectedStores = STORE_CONFIGS.map(config => config.name);
    
    for (const expectedStore of expectedStores) {
      if (!storeNames.includes(expectedStore)) {
        issues.push(`Missing object store: ${expectedStore}`);
      }
    }
    
    db.close();
    
    return {
      isHealthy: issues.length === 0 && currentVersion === SCHEMA_VERSION,
      currentVersion,
      expectedVersion: SCHEMA_VERSION,
      issues
    };
  } catch (error) {
    return {
      isHealthy: false,
      currentVersion: 0,
      expectedVersion: SCHEMA_VERSION,
      issues: [`Database error: ${error instanceof Error ? error.message : 'Unknown error'}`]
    };
  }
}

/**
 * Utility to delete the entire database (for development/testing)
 */
export async function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
    
    deleteRequest.onsuccess = () => {
      console.log('Database deleted successfully');
      resolve();
    };
    
    deleteRequest.onerror = () => {
      reject(deleteRequest.error);
    };
    
    deleteRequest.onblocked = () => {
      console.warn('Database deletion blocked. Please close all tabs using this database.');
    };
  });
}