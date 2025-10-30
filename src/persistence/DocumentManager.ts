// Document Manager - Handles document persistence with Slate content decomposition
// Integrates with SimpleIndexedDBAdapter to manage documents, canvas blocks, and ghosts

import { v4 as uuidv4 } from 'uuid';
import type { 
  DocumentRecord, 
  CanvasBlockRecord, 
  GhostRecord,
  SessionRecord,
  TurnRecord,
  ProviderResponseRecord
} from './types';
import type { SimpleIndexedDBAdapter } from './SimpleIndexedDBAdapter.js';

// Slate.js types for content decomposition
interface SlateNode {
  type: string;
  children?: SlateNode[];
  text?: string;
  [key: string]: any;
}

interface SlateDescendant extends SlateNode {
  id?: string;
  provenance?: {
    sessionId: string;
    aiTurnId: string;
    providerId: string;
    responseType: 'batch' | 'synthesis' | 'mapping' | 'hidden';
    responseIndex: number;
    textRange?: [number, number];
  };
  metadata?: {
    granularity?: 'full' | 'paragraph' | 'sentence' | 'unknown';
    timestamp?: number;
    originalIndex?: number;
  };
}

interface DocumentSnapshot {
  id: string;
  timestamp: number;
  canvasContent: SlateDescendant[];
  blockCount: number;
  label?: string;
}

interface RefinementEntry {
  id: string;
  timestamp: number;
  type: 'manual_edit' | 'ai_refinement' | 'merge' | 'split';
  description: string;
  blockIds: string[];
}

interface ExportEntry {
  id: string;
  timestamp: number;
  format: 'markdown' | 'html' | 'docx' | 'pdf';
  filename: string;
  size: number;
}

export interface DocumentManagerConfig {
  autoSaveInterval?: number;
  maxSnapshots?: number;
  enableAutoDecomposition?: boolean;
  compressionThreshold?: number;
}

export class DocumentManager {
  private adapter: SimpleIndexedDBAdapter;
  private config: DocumentManagerConfig;
  private autoSaveTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    adapter: SimpleIndexedDBAdapter,
    config: DocumentManagerConfig = {}
  ) {
    this.adapter = adapter;
    this.config = {
      autoSaveInterval: 2000,
      maxSnapshots: 10,
      enableAutoDecomposition: true,
      compressionThreshold: 1000,
      ...config
    };
  }

  /**
   * Create a new document with optional initial content
   */
  async createDocument(
    title: string,
    sourceSessionId?: string,
    initialContent?: SlateDescendant[]
  ): Promise<DocumentRecord> {
    const documentId = uuidv4();
    const now = Date.now();
    
    const document: DocumentRecord = {
      id: documentId,
      title,
      sourceSessionId,
      canvasContent: initialContent || [{ type: 'paragraph', children: [{ text: '' }] }],
      granularity: 'paragraph',
      isDirty: false,
      createdAt: now,
      updatedAt: now,
      lastModified: now,
      version: 1,
      blockCount: initialContent ? this.countBlocks(initialContent) : 0,
      refinementHistory: [],
      exportHistory: [],
      snapshots: []
    };

    // Save document
    await this.adapter.put('documents', document);

    // Decompose content into blocks if enabled
    if (this.config.enableAutoDecomposition && initialContent) {
      await this.decomposeContent(documentId, initialContent);
    }

    return document;
  }

  /**
   * Load a document with optional content reconstruction
   */
  async loadDocument(documentId: string, includeBlocks: boolean = false): Promise<DocumentRecord | null> {
    const document = await this.adapter.get('documents', documentId) as DocumentRecord | undefined;
    if (!document) return null;

    if (includeBlocks) {
      // Reconstruct content from blocks if needed
      const allBlocks = await this.adapter.getAll('canvasBlocks') as CanvasBlockRecord[];
      const blocks = allBlocks.filter((block) => block.documentId === documentId);
      if (blocks.length > 0) {
        document.canvasContent = await this.reconstructContent(blocks);
      }
    }

    return document;
  }

  /**
   * Save document with automatic content decomposition
   */
  async saveDocument(
    documentId: string,
    updates: Partial<DocumentRecord>,
    content?: SlateDescendant[]
  ): Promise<DocumentRecord> {
    const existingDoc = await this.adapter.get('documents', documentId) as DocumentRecord | undefined;
    if (!existingDoc) {
      throw new Error(`Document ${documentId} not found`);
    }

    const now = Date.now();
    const updatedDocument: DocumentRecord = {
      ...existingDoc,
      ...updates,
      lastModified: now,
      updatedAt: now,
      version: existingDoc.version + 1,
      isDirty: false
    };

    // Handle content updates
    if (content) {
      updatedDocument.canvasContent = content;
      updatedDocument.blockCount = this.countBlocks(content);
      
      // Decompose content if enabled
      if (this.config.enableAutoDecomposition) {
        await this.decomposeContent(documentId, content);
      }
    }

    // Create snapshot if needed
    if (this.shouldCreateSnapshot(existingDoc, updatedDocument)) {
      await this.createSnapshot(documentId, existingDoc);
    }

    await this.adapter.put('documents', updatedDocument);
    return updatedDocument;
  }

  /**
   * Delete a document and all associated data
   */
  async deleteDocument(documentId: string): Promise<void> {
    // Get all blocks and ghosts for this document
    const [allBlocks, allGhosts] = await Promise.all([
      this.adapter.getAll('canvasBlocks') as Promise<CanvasBlockRecord[]>,
      this.adapter.getAll('ghosts') as Promise<GhostRecord[]>
    ]);

    const blocks = (allBlocks as CanvasBlockRecord[]).filter(block => block.documentId === documentId);
    const ghosts = (allGhosts as GhostRecord[]).filter(ghost => ghost.documentId === documentId);

    // Delete blocks
    for (const block of blocks) {
      await this.adapter.delete('canvasBlocks', block.id);
    }

    // Delete ghosts
    for (const ghost of ghosts) {
      await this.adapter.delete('ghosts', ghost.id);
    }

    // Cascade delete: remove metadata associated with this document
    try {
      const allMetadata = await this.adapter.getAll('metadata') as any[];
      const docMetadata = allMetadata.filter((m) => m && m.entityId === documentId);
      for (const meta of docMetadata) {
        if (meta?.id) {
          await this.adapter.delete('metadata', meta.id);
        }
      }
    } catch (err) {
      console.warn('[DocumentManager] Failed to cascade delete metadata for document', documentId, err);
    }

    // Delete the document itself
    await this.adapter.delete('documents', documentId);
  }

  /**
   * Decompose Slate content into canvas blocks
   */
  private async decomposeContent(documentId: string, content: SlateDescendant[]): Promise<void> {
    // Clear existing blocks
    const allBlocks = await this.adapter.getAll('canvasBlocks') as CanvasBlockRecord[];
    const existingBlocks = allBlocks.filter((block) => block.documentId === documentId);
    for (const block of existingBlocks) {
      await this.adapter.delete('canvasBlocks', block.id);
    }

    // Create new blocks
    let order = 0;
    for (const node of content) {
      const blocks = await this.nodeToBlocks(documentId, node, order);
      for (const block of blocks) {
        await this.adapter.put('canvasBlocks', block);
      }
      order += blocks.length;
    }
  }

  /**
   * Convert a Slate node to canvas block records
   */
  private async nodeToBlocks(
    documentId: string,
    node: SlateDescendant,
    startOrder: number
  ): Promise<CanvasBlockRecord[]> {
    const blocks: CanvasBlockRecord[] = [];
    const now = Date.now();

    // Extract text content
    const text = this.extractText(node);
    
    // Create main block
    const block: CanvasBlockRecord = {
      id: node.id || uuidv4(),
      documentId,
      order: startOrder,
      nodeType: node.type,
      text,
      slateNode: node,
      provenance: node.provenance ? {
        sessionId: node.provenance.sessionId,
        aiTurnId: node.provenance.aiTurnId,
        providerId: node.provenance.providerId,
        responseType: node.provenance.responseType,
        responseIndex: node.provenance.responseIndex,
        textRange: node.provenance.textRange
      } : {
        sessionId: 'unknown',
        aiTurnId: 'unknown',
        providerId: 'manual',
        responseType: 'batch',
        responseIndex: 0
      },
      cachedSourceText: text,
      isOrphaned: false,
      createdAt: now,
      updatedAt: now
    };

    blocks.push(block);

    // Recursively process children if they exist
    if (node.children && Array.isArray(node.children)) {
      let childOrder = startOrder + 1;
      for (const child of node.children) {
        if (child.type && child.type !== 'text') {
          const childBlocks = await this.nodeToBlocks(documentId, child, childOrder);
          blocks.push(...childBlocks);
          childOrder += childBlocks.length;
        }
      }
    }

    return blocks;
  }

  /**
   * Reconstruct Slate content from canvas blocks
   */
  private async reconstructContent(blocks: CanvasBlockRecord[]): Promise<SlateDescendant[]> {
    const sortedBlocks = blocks.sort((a, b) => a.order - b.order);
    const content: SlateDescendant[] = [];

    for (const block of sortedBlocks) {
      // Use the stored Slate node with potential updates
      const node: SlateDescendant = {
        ...block.slateNode,
        id: block.id
      };

      // Update provenance if it exists
      if (block.provenance) {
        node.provenance = block.provenance;
      }

      content.push(node);
    }

    return content;
  }

  /**
   * Create a ghost from content
   */
  async createGhost(
    documentId: string,
    text: string,
    provenance: {
      sessionId: string;
      aiTurnId: string;
      providerId: string;
      responseType: 'batch' | 'synthesis' | 'mapping' | 'hidden';
      responseIndex: number;
      textRange?: [number, number];
    }
  ): Promise<GhostRecord> {
    // Check for existing ghost with same provenance
    const allGhosts = await this.adapter.getAll('ghosts') as GhostRecord[];
    const existingGhosts = allGhosts.filter(ghost => ghost.entityId === provenance.aiTurnId);
    const duplicate = existingGhosts.find(ghost => 
      ghost.documentId === documentId &&
      ghost.provenance?.providerId === provenance.providerId &&
      ghost.provenance?.responseIndex === provenance.responseIndex
    );

    if (duplicate) {
      return duplicate;
    }

    const ghost: GhostRecord = {
      id: uuidv4(),
      documentId,
      text,
      preview: text.substring(0, 100),
      provenance: {
        sessionId: provenance.sessionId,
        aiTurnId: provenance.aiTurnId,
        providerId: provenance.providerId,
        responseType: provenance.responseType,
        responseIndex: provenance.responseIndex
      },
      order: 0,
      createdAt: Date.now(),
      timestamp: Date.now(),
      isPinned: false
    };

    await this.adapter.put('ghosts', ghost);
    return ghost;
  }

  /**
   * Get all ghosts for a document
   */
  async getDocumentGhosts(documentId: string): Promise<GhostRecord[]> {
    const allGhosts = await this.adapter.getAll('ghosts') as GhostRecord[];
    return allGhosts.filter(ghost => ghost.documentId === documentId);
  }

  /**
   * Create a snapshot of the document
   */
  async createSnapshot(documentId: string, document: DocumentRecord, label?: string): Promise<void> {
    const snapshot: DocumentSnapshot = {
      id: uuidv4(),
      timestamp: Date.now(),
      canvasContent: document.canvasContent,
      blockCount: document.blockCount,
      label
    };

    // Add to snapshots array
    const snapshots = [...(document.snapshots || []), snapshot];
    
    // Keep only the most recent snapshots
    if (snapshots.length > this.config.maxSnapshots!) {
      snapshots.splice(0, snapshots.length - this.config.maxSnapshots!);
    }

    await this.adapter.put('documents', {
      ...document,
      snapshots
    });
  }

  /**
   * Get document provenance information
   */
  async getDocumentProvenance(documentId: string): Promise<{
    sessions: SessionRecord[];
    turns: TurnRecord[];
    responses: ProviderResponseRecord[];
  }> {
    const allBlocks = await this.adapter.getAll('canvasBlocks') as CanvasBlockRecord[];
    const blocks = allBlocks.filter((block) => block.documentId === documentId);
    
    // Extract unique session and turn IDs
    const sessionIds = new Set<string>();
    const turnIds = new Set<string>();
    
    blocks.forEach((block: CanvasBlockRecord) => {
      if (block.metadata?.provenance) {
        sessionIds.add(block.metadata.provenance.sessionId);
        turnIds.add(block.metadata.provenance.aiTurnId);
      }
    });

    // Fetch related records
    const [sessions, turns] = await Promise.all([
      Promise.all(Array.from(sessionIds).map(async (id: string) => {
        return await this.adapter.get('sessions', id) as SessionRecord | undefined;
      })).then((results: (SessionRecord | undefined)[]) =>
        results.filter((s): s is SessionRecord => s !== undefined)
      ),
      Promise.all(Array.from(turnIds).map(async (id: string) => {
        return await this.adapter.get('turns', id) as TurnRecord | undefined;
      })).then((results: (TurnRecord | undefined)[]) =>
        results.filter((t): t is TurnRecord => t !== undefined)
      )
    ]);

    // Get provider responses for the turns
    const responseKeys = turns.flatMap((turn: TurnRecord) => 
      turn.providerResponseIds?.map((id: string) => id) || []
    );
    const responses = await this.getResponsesByKeys(responseKeys);

    return { sessions, turns, responses };
  }

  /**
   * Auto-save document with debouncing
   */
  enableAutoSave(documentId: string, getDocument: () => DocumentRecord): void {
    // Clear existing timer
    const existingTimer = this.autoSaveTimers.get(documentId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(async () => {
      try {
        const document = getDocument();
        if (document.isDirty) {
          await this.saveDocument(documentId, document);
        }
      } catch (error) {
        console.error(`Auto-save failed for document ${documentId}:`, error);
      } finally {
        this.autoSaveTimers.delete(documentId);
      }
    }, this.config.autoSaveInterval);

    this.autoSaveTimers.set(documentId, timer);
  }

  /**
   * Disable auto-save for a document
   */
  disableAutoSave(documentId: string): void {
    const timer = this.autoSaveTimers.get(documentId);
    if (timer) {
      clearTimeout(timer);
      this.autoSaveTimers.delete(documentId);
    }
  }

  // Helper methods

  private extractText(node: SlateDescendant): string {
    if (node.text !== undefined) {
      return node.text;
    }

    if (node.children && Array.isArray(node.children)) {
      return node.children.map(child => this.extractText(child)).join('');
    }

    return '';
  }

  private countBlocks(content: SlateDescendant[]): number {
    let count = 0;
    for (const node of content) {
      count++;
      if (node.children && Array.isArray(node.children)) {
        count += this.countBlocks(node.children.filter(child => child.type && child.type !== 'text'));
      }
    }
    return count;
  }

  private shouldCreateSnapshot(oldDoc: DocumentRecord, newDoc: DocumentRecord): boolean {
    // Create snapshot if significant content change or version milestone
    const contentChanged = JSON.stringify(oldDoc.canvasContent) !== JSON.stringify(newDoc.canvasContent);
    const versionMilestone = newDoc.version % 5 === 0;
    
    return contentChanged && (versionMilestone || newDoc.blockCount !== oldDoc.blockCount);
  }

  private async getResponsesByKeys(keys: string[]): Promise<ProviderResponseRecord[]> {
    const responses: ProviderResponseRecord[] = [];
    
    for (const key of keys) {
      try {
        // Parse compound key: sessionId|turnId|providerId|responseIndex
        const [sessionId, turnId, providerId, responseIndex] = key.split('|');
        const response = await this.adapter.get('providerResponses', key) as ProviderResponseRecord | undefined;
        if (response) {
          responses.push(response);
        }
      } catch (error) {
        console.warn(`Failed to fetch response for key ${key}:`, error);
      }
    }
    
    return responses;
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    // Clear all auto-save timers
    for (const timer of this.autoSaveTimers.values()) {
      clearTimeout(timer);
    }
    this.autoSaveTimers.clear();
  }
}

/**
 * Factory function to create a document manager
 */
export function createDocumentManager(
  adapter: SimpleIndexedDBAdapter,
  config?: DocumentManagerConfig
): DocumentManager {
  return new DocumentManager(
    adapter,
    config
  );
}