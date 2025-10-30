// Ghosts Repository - Manages ghost records for temporal state tracking

import { BaseRepository } from '../BaseRepository';
import { GhostRecord } from '../types';

export class GhostsRepository extends BaseRepository<GhostRecord> {
  constructor(db: IDBDatabase) {
    super(db, 'ghosts');
  }

  /**
   * Get ghosts by document ID
   */
  async getByDocumentId(documentId: string): Promise<GhostRecord[]> {
    return this.getByIndex('byDocumentId', documentId);
  }

  /**
   * Get ghosts by entity ID (scan fallback; no index)
   */
  async getByEntityId(entityId: string): Promise<GhostRecord[]> {
    const ghosts = await this.getAll();
    return ghosts
      .filter(g => g.entityId === entityId)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  /**
   * Get ghosts by entity type (scan fallback)
   */
  async getByEntityType(entityType: string): Promise<GhostRecord[]> {
    const ghosts = await this.getAll();
    return ghosts.filter(g => g.entityType === entityType);
  }

  /**
   * Get ghosts by session ID (indexed via provenance.sessionId)
   */
  async getBySessionId(sessionId: string): Promise<GhostRecord[]> {
    return this.getByIndex('bySessionId', sessionId);
  }

  /**
   * Get ghosts by operation type (scan fallback)
   */
  async getByOperation(operation: 'create' | 'update' | 'delete'): Promise<GhostRecord[]> {
    const ghosts = await this.getAll();
    return ghosts.filter(g => g.operation === operation);
  }

  /**
   * Get ghosts within a time range (by createdAt index)
   */
  async getByTimeRange(startTime: Date, endTime: Date): Promise<GhostRecord[]> {
    const range = IDBKeyRange.bound(startTime.getTime(), endTime.getTime());
    return this.getByIndex('byCreatedAt', range);
  }

  /**
   * Get latest ghost for an entity
   */
  async getLatestByEntityId(entityId: string): Promise<GhostRecord | null> {
    const ghosts = await this.getByEntityId(entityId);
    return ghosts.length > 0 ? ghosts[0] : null;
  }

  /**
   * Get ghost at specific timestamp
   */
  async getAtTimestamp(entityId: string, timestamp: number): Promise<GhostRecord | null> {
    const ghosts = await this.getByEntityId(entityId);
    
    // Find the ghost that was active at the given timestamp
    return ghosts.find(ghost => (ghost.timestamp || 0) <= timestamp) || null;
  }

  /**
   * Get entity history (all ghosts for an entity)
   */
  async getEntityHistory(entityId: string): Promise<GhostRecord[]> {
    return this.getByEntityId(entityId);
  }

  /**
   * Get entity state at specific point in time
   */
  async getEntityStateAt(entityId: string, timestamp: number): Promise<any | null> {
    const ghost = await this.getAtTimestamp(entityId, timestamp);
    return ghost ? ghost.state : null;
  }

  /**
   * Create ghost snapshot
   */
  async createSnapshot(
    entityId: string,
    entityType: string,
    sessionId: string,
    operation: 'create' | 'update' | 'delete',
    state: any,
    metadata?: Record<string, any>
  ): Promise<GhostRecord> {
    const ghost: GhostRecord = {
      id: crypto.randomUUID(),
      documentId: entityId,  // Map entityId to documentId
      text: JSON.stringify(state),  // Convert state to text
      preview: JSON.stringify(state).substring(0, 200),  // First 200 chars
      provenance: {
        sessionId,
        aiTurnId: entityId,  // Use entityId as aiTurnId for now
        providerId: 'system',  // Default provider
        responseType: 'batch' as const,
        responseIndex: 0
      },
      order: 0,  // Default order
      createdAt: Date.now(),
      isPinned: false,
      timestamp: Date.now(),
      entityId,
      entityType,
      operation,
      state,
      metadata: metadata || {}
    };

    await this.add(ghost);
    return ghost;
  }

  /**
   * Get changes between two timestamps
   */
  async getChangesBetween(
    entityId: string,
    startTime: number,
    endTime: number
  ): Promise<GhostRecord[]> {
    const ghosts = await this.getByEntityId(entityId);
    
    return ghosts.filter(ghost => 
      (ghost.timestamp || 0) >= startTime && (ghost.timestamp || 0) <= endTime
    );
  }

  /**
   * Get recent activity for a session
   */
  async getRecentActivity(sessionId: string, limit: number = 50): Promise<GhostRecord[]> {
    const ghosts = await this.getBySessionId(sessionId);
    return ghosts
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, limit);
  }

  /**
   * Get activity statistics for a session
   */
  async getSessionActivityStats(sessionId: string): Promise<{
    total: number;
    byOperation: Record<string, number>;
    byEntityType: Record<string, number>;
    timeRange: { start: number; end: number } | null;
    entitiesModified: number;
  }> {
    const ghosts = await this.getBySessionId(sessionId);
    
    const stats = {
      total: ghosts.length,
      byOperation: {} as Record<string, number>,
      byEntityType: {} as Record<string, number>,
      timeRange: null as { start: number; end: number } | null,
      entitiesModified: 0
    };

    if (ghosts.length === 0) {
      return stats;
    }

    const timestamps = ghosts.map(g => g.timestamp || 0).filter(t => t > 0);
    if (timestamps.length > 0) {
      stats.timeRange = {
        start: Math.min(...timestamps),
        end: Math.max(...timestamps)
      };
    }

    const uniqueEntities = new Set<string>();

    ghosts.forEach(ghost => {
      if (ghost.operation) {
        stats.byOperation[ghost.operation] = (stats.byOperation[ghost.operation] || 0) + 1;
      }
      if (ghost.entityType) {
        stats.byEntityType[ghost.entityType] = (stats.byEntityType[ghost.entityType] || 0) + 1;
      }
      if (ghost.entityId) {
        uniqueEntities.add(ghost.entityId);
      }
    });

    stats.entitiesModified = uniqueEntities.size;

    return stats;
  }

  /**
   * Restore entity to a specific timestamp
   */
  async restoreEntityTo(entityId: string, timestamp: number): Promise<any | null> {
    const targetGhost = await this.getAtTimestamp(entityId, timestamp);
    
    if (!targetGhost || !targetGhost.entityType || !targetGhost.provenance?.sessionId) {
      return null;
    }

    // Create a new ghost record for the restoration
    await this.createSnapshot(
      entityId,
      targetGhost.entityType,
      targetGhost.provenance.sessionId,
      'update',
      targetGhost.state,
      {
        restoredFrom: targetGhost.id,
        restoredAt: Date.now(),
        originalTimestamp: targetGhost.timestamp
      }
    );

    return targetGhost.state;
  }

  /**
   * Get diff between two ghost states
   */
  async getDiff(ghostId1: string, ghostId2: string): Promise<{
    ghost1: GhostRecord | null;
    ghost2: GhostRecord | null;
    changes: any;
  }> {
    const [ghost1, ghost2] = await Promise.all([
      this.get(ghostId1),
      this.get(ghostId2)
    ]);

    const changes = this.calculateStateDiff(
      ghost1?.state || {},
      ghost2?.state || {}
    );

    return { ghost1, ghost2, changes };
  }

  /**
   * Calculate differences between two states
   */
  private calculateStateDiff(state1: any, state2: any): any {
    const changes: any = {};

    // Simple diff implementation - can be enhanced with more sophisticated diffing
    const keys = new Set([...Object.keys(state1 || {}), ...Object.keys(state2 || {})]);

    for (const key of keys) {
      const val1 = state1?.[key];
      const val2 = state2?.[key];

      if (JSON.stringify(val1) !== JSON.stringify(val2)) {
        changes[key] = {
          from: val1,
          to: val2
        };
      }
    }

    return changes;
  }

  /**
   * Clean up old ghosts while preserving minimum count
   */
  async cleanupOldGhosts(olderThanDays: number = 90, keepMinimum: number = 5): Promise<number> {
    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    
    // Get all ghosts sorted by timestamp (newest first)
    const allGhosts = await this.getAll();
    const sortedGhosts = allGhosts
      .filter(ghost => ghost.timestamp !== undefined)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    
    // Keep minimum number of ghosts regardless of age
    const ghostsToConsider = sortedGhosts.slice(keepMinimum);
    
    // Find ghosts older than cutoff
    const ghostsToDelete = ghostsToConsider.filter(ghost => 
      ghost.timestamp !== undefined && ghost.timestamp < cutoffTime
    );
    
    // Delete old ghosts
    let deletedCount = 0;
    for (const ghost of ghostsToDelete) {
      await this.delete(ghost.id);
      deletedCount++;
    }
    
    return deletedCount;
  }

  /**
   * Get timeline of ghosts for multiple entities
   */
  async getTimeline(
    entityIds: string[],
    startTime?: number,
    endTime?: number
  ): Promise<GhostRecord[]> {
    const allGhosts: GhostRecord[] = [];
    
    for (const entityId of entityIds) {
      const entityGhosts = await this.getByEntityId(entityId);
      allGhosts.push(...entityGhosts);
    }
    
    // Filter by time range if provided
    let filteredGhosts = allGhosts;
    if (startTime !== undefined || endTime !== undefined) {
      filteredGhosts = allGhosts.filter(ghost => {
        if (ghost.timestamp === undefined) return false;
        if (startTime !== undefined && ghost.timestamp < startTime) return false;
        if (endTime !== undefined && ghost.timestamp > endTime) return false;
        return true;
      });
    }
    
    // Sort by timestamp
    return filteredGhosts.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }

  /**
   * Get entities modified within time range
   */
  async getModifiedEntities(
    startTime: number,
    endTime: number,
    entityType?: string
  ): Promise<string[]> {
    const range = IDBKeyRange.bound(startTime, endTime);
    const ghosts = await this.getByIndex('byCreatedAt', range);
    
    const entityIds = ghosts
      .filter(ghost => !entityType || ghost.entityType === entityType)
      .map(ghost => ghost.entityId)
      .filter((id): id is string => id !== undefined);
    
    // Remove duplicates
    return [...new Set(entityIds)];
  }

  /**
   * Update ghost metadata
   */
  async updateMetadata(ghostId: string, metadata: Record<string, any>): Promise<void> {
    const ghost = await this.get(ghostId);
    if (ghost) {
      ghost.metadata = { ...ghost.metadata, ...metadata };
      await this.put(ghost);
    }
  }

  /**
   * Get ghost statistics by entity type
   */
  async getStatsByEntityType(): Promise<Record<string, {
    total: number;
    byOperation: Record<string, number>;
    oldestTimestamp: number;
    newestTimestamp: number;
  }>> {
    const allGhosts = await this.getAll();
    const stats: Record<string, any> = {};
    
    for (const ghost of allGhosts) {
      if (!ghost.entityType) continue;
      
      const entityType = ghost.entityType;
      if (!stats[entityType]) {
        stats[entityType] = {
          total: 0,
          byOperation: {},
          oldestTimestamp: Number.MAX_SAFE_INTEGER,
          newestTimestamp: 0
        };
      }
      
      stats[entityType].total++;
      
      if (ghost.operation) {
        const operation = ghost.operation;
        if (!stats[entityType].byOperation[operation]) {
          stats[entityType].byOperation[operation] = 0;
        }
        stats[entityType].byOperation[operation]++;
      }
      
      if (ghost.timestamp !== undefined) {
        stats[entityType].oldestTimestamp = Math.min(stats[entityType].oldestTimestamp, ghost.timestamp);
        stats[entityType].newestTimestamp = Math.max(stats[entityType].newestTimestamp, ghost.timestamp);
      }
    }
    
    return stats;
  }
}