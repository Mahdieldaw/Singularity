//// Canvas Blocks Repository - Manages canvas block records

import { BaseRepository } from '../BaseRepository';
import { CanvasBlockRecord } from '../types';

export class CanvasBlocksRepository extends BaseRepository<CanvasBlockRecord> {
  constructor(db: IDBDatabase) {
    super(db, 'canvas_blocks');
  }

  /**
   * Get blocks by document ID
   */
  async getByDocumentId(documentId: string): Promise<CanvasBlockRecord[]> {
    const blocks = await this.getByIndex('byDocumentId', documentId);
    return blocks.sort((a, b) => a.order - b.order);
  }

  /**
   * Get blocks by session ID
   */
  async getBySessionId(sessionId: string): Promise<CanvasBlockRecord[]> {
    return this.getByIndex('bySessionId', sessionId);
  }

  /**
   * Get blocks by type
   */
  async getByType(type: string): Promise<CanvasBlockRecord[]> {
    const allBlocks = await this.getAll();
    return allBlocks.filter(block => block.type === type);
  }

  /**
   * Get blocks by parent ID (child blocks)
   */
  async getByParentId(parentId: string): Promise<CanvasBlockRecord[]> {
    const allBlocks = await this.getAll();
    const blocks = allBlocks.filter(block => block.parentId === parentId);
    return blocks.sort((a, b) => a.order - b.order);
  }

  /**
   * Get root blocks for a document (blocks without parent)
   */
  async getRootBlocksByDocumentId(documentId: string): Promise<CanvasBlockRecord[]> {
    const allBlocks = await this.getByDocumentId(documentId);
    return allBlocks.filter(block => !block.parentId);
  }

  /**
   * Get block hierarchy for a document
   */
  async getBlockHierarchy(documentId: string): Promise<CanvasBlockRecord[]> {
    const allBlocks = await this.getByDocumentId(documentId);
    const blockMap = new Map(allBlocks.map(block => [block.id, block]));
    
    // Build hierarchy by adding children to parents
    const hierarchy: CanvasBlockRecord[] = [];
    
    for (const block of allBlocks) {
      if (!block.parentId) {
        // Root block
        hierarchy.push(this.buildBlockTree(block, blockMap));
      }
    }
    
    return hierarchy.sort((a, b) => a.order - b.order);
  }

  /**
   * Build block tree recursively
   */
  private buildBlockTree(
    block: CanvasBlockRecord, 
    blockMap: Map<string, CanvasBlockRecord>
  ): CanvasBlockRecord {
    const children: CanvasBlockRecord[] = [];
    
    for (const [id, childBlock] of blockMap) {
      if (childBlock.parentId === block.id) {
        children.push(this.buildBlockTree(childBlock, blockMap));
      }
    }
    
    return {
      ...block,
      children: children.sort((a, b) => a.order - b.order).map(child => child.id)
    };
  }

  /**
   * Get blocks by depth level
   */
  async getBlocksByDepth(documentId: string, depth: number): Promise<CanvasBlockRecord[]> {
    const allBlocks = await this.getByDocumentId(documentId);
    
    // Calculate depth for each block
    const blocksWithDepth = allBlocks.map(block => {
      let currentDepth = 0;
      let currentBlock = block;
      
      while (currentBlock.parentId) {
        currentDepth++;
        currentBlock = allBlocks.find(b => b.id === currentBlock.parentId)!;
        if (!currentBlock) break; // Prevent infinite loop
      }
      
      return { ...block, depth: currentDepth };
    });
    
    return blocksWithDepth
      .filter(block => block.depth === depth)
      .sort((a, b) => a.order - b.order);
  }

  /**
   * Update block content
   */
  async updateContent(blockId: string, content: any): Promise<void> {
    const block = await this.get(blockId);
    if (block) {
      block.content = content;
      block.updatedAt = Date.now();
      await this.put(block);
    }
  }

  /**
   * Update block order
   */
  async updateOrder(blockId: string, newOrder: number): Promise<void> {
    const block = await this.get(blockId);
    if (block) {
      block.order = newOrder;
      block.updatedAt = Date.now();
      await this.put(block);
    }
  }

  /**
   * Move block to new parent
   */
  async moveBlock(blockId: string, newParentId: string | null, newOrder: number): Promise<void> {
    const block = await this.get(blockId);
    if (block) {
      block.parentId = newParentId || undefined;
      block.order = newOrder;
      block.updatedAt = Date.now();
      await this.put(block);
    }
  }

  /**
   * Reorder blocks within same parent
   */
  async reorderBlocks(parentId: string | null, blockOrders: { blockId: string; order: number }[]): Promise<void> {
    const blocks = parentId 
      ? await this.getByParentId(parentId)
      : await this.getRootBlocksByDocumentId(blockOrders[0]?.blockId ? 
          (await this.get(blockOrders[0].blockId))?.documentId || '' : '');
    
    const updates = blockOrders.map(({ blockId, order }) => {
      const block = blocks.find(b => b.id === blockId);
      if (block) {
        return {
          ...block,
          order,
          updatedAt: Date.now()
        };
      }
      return null;
    }).filter(Boolean) as CanvasBlockRecord[];

    if (updates.length > 0) {
      await this.putMany(updates);
    }
  }

  /**
   * Get next order number for a parent
   */
  async getNextOrder(documentId: string, parentId: string | null): Promise<number> {
    const siblings = parentId 
      ? await this.getByParentId(parentId)
      : await this.getRootBlocksByDocumentId(documentId);
    
    return siblings.length > 0 ? Math.max(...siblings.map(b => b.order)) + 1 : 0;
  }

  /**
   * Duplicate block and its children
   */
  async duplicateBlock(
    blockId: string, 
    newParentId: string | null = null,
    newDocumentId?: string
  ): Promise<CanvasBlockRecord> {
    const original = await this.get(blockId);
    if (!original) {
      throw new Error('Block not found');
    }

    const targetDocumentId = newDocumentId || original.documentId;
    const targetParentId = newParentId !== undefined ? (newParentId || undefined) : original.parentId;
    
    const newOrder = await this.getNextOrder(targetDocumentId, targetParentId || null);
    
    const duplicate: CanvasBlockRecord = {
      ...original,
      id: crypto.randomUUID(),
      parentId: targetParentId,
      documentId: targetDocumentId,
      order: newOrder,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {
        ...original.metadata,
        duplicatedFrom: blockId,
        duplicatedAt: Date.now()
      }
    };

    await this.add(duplicate);

    // Duplicate children recursively
    const children = await this.getByParentId(blockId);
    for (const child of children) {
      await this.duplicateBlock(child.id, duplicate.id, targetDocumentId);
    }

    return duplicate;
  }

  /**
   * Delete block and its children
   */
  async deleteBlockTree(blockId: string): Promise<number> {
    const children = await this.getByParentId(blockId);
    let deletedCount = 0;

    // Recursively delete children first
    for (const child of children) {
      deletedCount += await this.deleteBlockTree(child.id);
    }

    // Delete the block itself
    await this.delete(blockId);
    deletedCount++;

    return deletedCount;
  }

  /**
   * Get block path (from root to block)
   */
  async getBlockPath(blockId: string): Promise<CanvasBlockRecord[]> {
    const path: CanvasBlockRecord[] = [];
    let currentBlock = await this.get(blockId);

    while (currentBlock) {
      path.unshift(currentBlock);
      if (currentBlock.parentId) {
        currentBlock = await this.get(currentBlock.parentId);
      } else {
        break;
      }
    }

    return path;
  }

  /**
   * Search blocks by content
   */
  async searchByContent(query: string, documentId?: string): Promise<CanvasBlockRecord[]> {
    const searchQuery = query.toLowerCase();
    let blocks: CanvasBlockRecord[];

    if (documentId) {
      blocks = await this.getByDocumentId(documentId);
    } else {
      blocks = await this.getAll();
    }

    return blocks.filter(block => {
      const contentStr = typeof block.content === 'string' 
        ? block.content 
        : JSON.stringify(block.content);
      return contentStr.toLowerCase().includes(searchQuery);
    });
  }

  /**
   * Get block statistics for a document
   */
  async getDocumentBlockStats(documentId: string): Promise<{
    total: number;
    byType: Record<string, number>;
    maxDepth: number;
    averageDepth: number;
    rootBlocks: number;
  }> {
    const blocks = await this.getByDocumentId(documentId);
    
    const stats = {
      total: blocks.length,
      byType: {} as Record<string, number>,
      maxDepth: 0,
      averageDepth: 0,
      rootBlocks: blocks.filter(b => !b.parentId).length
    };

    let totalDepth = 0;

    for (const block of blocks) {
      // Count by type
      if (block.type) {
    stats.byType[block.type] = (stats.byType[block.type] || 0) + 1;
}
      
      // Calculate depth
      let depth = 0;
      let currentBlock = block;
      
      while (currentBlock.parentId) {
        depth++;
        currentBlock = blocks.find(b => b.id === currentBlock.parentId)!;
        if (!currentBlock) break;
      }
      
      totalDepth += depth;
      stats.maxDepth = Math.max(stats.maxDepth, depth);
    }

    stats.averageDepth = blocks.length > 0 ? totalDepth / blocks.length : 0;

    return stats;
  }

  /**
   * Get blocks by type for a document
   */
  async getByDocumentAndType(documentId: string, type: string): Promise<CanvasBlockRecord[]> {
    const documentBlocks = await this.getByDocumentId(documentId);
    return documentBlocks.filter(block => block.type === type);
  }

  /**
   * Update block metadata
   */
  async updateMetadata(blockId: string, metadata: Record<string, any>): Promise<void> {
    const block = await this.get(blockId);
    if (block) {
      block.metadata = { ...block.metadata, ...metadata };
      block.updatedAt = Date.now();
      await this.put(block);
    }
  }

  /**
   * Get leaf blocks (blocks without children)
   */
  async getLeafBlocks(documentId: string): Promise<CanvasBlockRecord[]> {
    const allBlocks = await this.getByDocumentId(documentId);
    const parentIds = new Set(allBlocks.map(b => b.parentId).filter(Boolean));
    
    return allBlocks.filter(block => !parentIds.has(block.id));
  }

  /**
   * Flatten block hierarchy to linear array
   */
  async getFlattenedBlocks(documentId: string): Promise<CanvasBlockRecord[]> {
    const hierarchy = await this.getBlockHierarchy(documentId);
    const flattened: CanvasBlockRecord[] = [];

    const flatten = (blocks: CanvasBlockRecord[]) => {
      for (const block of blocks) {
        flattened.push(block);
        if (block.children && block.children.length > 0) {
          // Convert string IDs to CanvasBlockRecord objects
          const childBlocks = hierarchy.filter(b => block.children?.includes(b.id));
          flatten(childBlocks);
        }
      }
    };

    flatten(hierarchy);
    return flattened;
  }
}