// Provider Contexts Repository - Manages provider context records

import { BaseRepository } from '../BaseRepository';
import { ProviderContextRecord } from '../types';

export class ProviderContextsRepository extends BaseRepository<ProviderContextRecord> {
  constructor(db: IDBDatabase) {
    super(db, 'provider_contexts');
  }

  /**
   * Get contexts by session ID
   */
  async getBySessionId(sessionId: string): Promise<ProviderContextRecord[]> {
    return this.getByIndex('bySessionId', sessionId);
  }

  /**
   * Get contexts by providerId
   */
  async getByProvider(providerId: string): Promise<ProviderContextRecord[]> {
    return this.getByIndex('byProviderId', providerId);
  }

  /**
   * Get contexts by thread ID (scan fallback; no index)
   */
  async getByThreadId(threadId: string): Promise<ProviderContextRecord[]> {
    const all = await this.getAll();
    return all.filter(c => c.threadId === threadId);
  }

  /**
   * Get contexts created within a date range (scan fallback)
   */
  async getByDateRange(startDate: Date, endDate: Date): Promise<ProviderContextRecord[]> {
    const start = startDate.getTime();
    const end = endDate.getTime();
    const all = await this.getAll();
    return all.filter(c => c.createdAt >= start && c.createdAt <= end);
  }

  /**
   * Get active contexts for a session
   */
  async getActiveBySessionId(sessionId: string): Promise<ProviderContextRecord[]> {
    const contexts = await this.getBySessionId(sessionId);
    return contexts.filter(context => context.isActive);
  }

  /**
   * Get contexts by provider and session
   */
  async getByProviderAndSession(providerId: string, sessionId: string): Promise<ProviderContextRecord[]> {
    const sessionContexts = await this.getBySessionId(sessionId);
    return sessionContexts.filter(context => context.providerId === providerId);
  }

  /**
   * Get latest context for a provider in a session
   */
  async getLatestByProviderAndSession(providerId: string, sessionId: string): Promise<ProviderContextRecord | null> {
    const contexts = await this.getByProviderAndSession(providerId, sessionId);
    return contexts.length > 0 
      ? contexts.sort((a, b) => b.updatedAt - a.updatedAt)[0]
      : null;
  }

  /**
   * Update context activity status
   */
  async updateActivity(contextId: string, isActive: boolean): Promise<void> {
    const context = await this.get(contextId);
    if (context) {
      context.isActive = isActive;
      context.updatedAt = Date.now();
      await this.put(context);
    }
  }

  /**
   * Update context data
   */
  async updateContextData(contextId: string, contextData: Record<string, any>): Promise<void> {
    const context = await this.get(contextId);
    if (context) {
      context.contextData = { ...context.contextData, ...contextData };
      context.updatedAt = Date.now();
      await this.put(context);
    }
  }

  /**
   * Update context metadata
   */
  async updateMetadata(contextId: string, metadata: Record<string, any>): Promise<void> {
    const context = await this.get(contextId);
    if (context) {
      context.metadata = { ...context.metadata, ...metadata };
      context.updatedAt = Date.now();
      await this.put(context);
    }
  }

  /**
   * Get context statistics for a session
   */
  async getSessionContextStats(sessionId: string): Promise<{
    total: number;
    active: number;
    byProvider: Record<string, number>;
    byThread: Record<string, number>;
    averageContextSize: number;
  }> {
    const contexts = await this.getBySessionId(sessionId);
    
    const stats = {
      total: contexts.length,
      active: contexts.filter(c => c.isActive).length,
      byProvider: {} as Record<string, number>,
      byThread: {} as Record<string, number>,
      averageContextSize: 0
    };

    let totalSize = 0;

    contexts.forEach(context => {
      stats.byProvider[context.providerId] = (stats.byProvider[context.providerId] || 0) + 1;
      if (context.threadId) {
        stats.byThread[context.threadId] = (stats.byThread[context.threadId] || 0) + 1;
      }
      
      // Calculate context size (rough estimate)
      const contextSize = JSON.stringify(context.contextData).length;
      totalSize += contextSize;
    });

    stats.averageContextSize = contexts.length > 0 ? totalSize / contexts.length : 0;

    return stats;
  }

  /**
   * Get provider performance statistics
   */
  async getProviderStats(providerId?: string): Promise<{
    totalContexts: number;
    activeContexts: number;
    averageContextLifetime: number;
    contextsBySession: Record<string, number>;
  }> {
    let contexts: ProviderContextRecord[];
    
    if (providerId) {
      contexts = await this.getByProvider(providerId);
    } else {
      contexts = await this.getAll();
    }

    const now = Date.now();
    let totalLifetime = 0;
    let lifetimeCount = 0;

    const contextsBySession: Record<string, number> = {};

    contexts.forEach(context => {
      contextsBySession[context.sessionId] = (contextsBySession[context.sessionId] || 0) + 1;
      
      // Calculate lifetime for inactive contexts
      if (!context.isActive) {
        totalLifetime += context.updatedAt - context.createdAt;
        lifetimeCount++;
      }
    });

    return {
      totalContexts: contexts.length,
      activeContexts: contexts.filter(c => c.isActive).length,
      averageContextLifetime: lifetimeCount > 0 ? totalLifetime / lifetimeCount : 0,
      contextsBySession
    };
  }

  /**
   * Search contexts by content
   */
  async searchByContent(query: string, providerId?: string): Promise<ProviderContextRecord[]> {
    const searchQuery = query.toLowerCase();
    let contexts: ProviderContextRecord[];

    if (providerId) {
      contexts = await this.getByProvider(providerId);
    } else {
      contexts = await this.getAll();
    }

    return contexts.filter(context => {
      const contextStr = JSON.stringify(context.contextData).toLowerCase();
      return contextStr.includes(searchQuery);
    });
  }

  /**
   * Get contexts with large data size
   */
  async getLargeContexts(minSizeBytes: number = 10000): Promise<ProviderContextRecord[]> {
    const allContexts = await this.getAll();
    
    return allContexts.filter(context => {
      const contextSize = JSON.stringify(context.contextData).length;
      return contextSize >= minSizeBytes;
    });
  }

  /**
   * Deactivate all contexts for a session
   */
  async deactivateAllForSession(sessionId: string): Promise<void> {
    const contexts = await this.getActiveBySessionId(sessionId);
    const updates = contexts.map(context => ({
      ...context,
      isActive: false,
      updatedAt: Date.now()
    }));
    
    if (updates.length > 0) {
      await this.putMany(updates);
    }
  }

  /**
   * Deactivate contexts for a specific provider in a session
   */
  async deactivateProviderContexts(providerId: string, sessionId: string): Promise<void> {
    const contexts = await this.getByProviderAndSession(providerId, sessionId);
    const activeContexts = contexts.filter(c => c.isActive);
    
    const updates = activeContexts.map(context => ({
      ...context,
      isActive: false,
      updatedAt: Date.now()
    }));
    
    if (updates.length > 0) {
      await this.putMany(updates);
    }
  }

  /**
   * Clean up old inactive contexts
   */
  async cleanupOldContexts(olderThanDays: number = 30): Promise<number> {
    // Defensive readiness check: ensure store exists
    if (!this.db || !Array.from(this.db.objectStoreNames).includes(this.storeName)) {
      console.warn(`[ProviderContextsRepository] Store ${this.storeName} not available; skipping cleanup`);
      return 0;
    }
    try {
      const cutoffDate = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
      const allContexts = await this.getAll();
      const toDelete = allContexts.filter(context => 
        !context.isActive && context.updatedAt < cutoffDate
      );

      if (toDelete.length > 0) {
        const ids = toDelete.map(context => context.id);
        await this.deleteMany(ids);
      }

      return toDelete.length;
    } catch (error) {
      if (error instanceof Error && (error.name === 'NotFoundError' || error.message?.includes('Missing object stores'))) {
        console.warn('[ProviderContextsRepository] Cleanup aborted due to missing store or NotFoundError:', error);
        return 0;
      }
      console.error('[ProviderContextsRepository] Cleanup failed:', error);
      return 0;
    }
  }

  /**
   * Get context usage timeline
   */
  async getContextTimeline(
    sessionId?: string,
    providerId?: string,
    startTime?: number,
    endTime?: number
  ): Promise<ProviderContextRecord[]> {
    let contexts: ProviderContextRecord[];

    if (sessionId) {
      contexts = await this.getBySessionId(sessionId);
    } else if (providerId) {
      contexts = await this.getByProvider(providerId);
    } else {
      contexts = await this.getAll();
    }

    // Filter by provider if sessionId was used but provider is also specified
    if (sessionId && providerId) {
      contexts = contexts.filter(c => c.providerId === providerId);
    }

    // Filter by time range
    if (startTime !== undefined) {
      contexts = contexts.filter(c => c.createdAt >= startTime);
    }

    if (endTime !== undefined) {
      contexts = contexts.filter(c => c.createdAt <= endTime);
    }

    return contexts.sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Get context data size statistics
   */
  async getContextSizeStats(providerId?: string): Promise<{
    totalContexts: number;
    totalSize: number;
    averageSize: number;
    maxSize: number;
    minSize: number;
    sizeDistribution: {
      small: number;    // < 1KB
      medium: number;   // 1KB - 10KB
      large: number;    // 10KB - 100KB
      xlarge: number;   // > 100KB
    };
  }> {
    let contexts: ProviderContextRecord[];
    
    if (providerId) {
      contexts = await this.getByProvider(providerId);
    } else {
      contexts = await this.getAll();
    }

    const sizes = contexts.map(context => JSON.stringify(context.contextData).length);
    
    const stats = {
      totalContexts: contexts.length,
      totalSize: sizes.reduce((sum, size) => sum + size, 0),
      averageSize: sizes.length > 0 ? sizes.reduce((sum, size) => sum + size, 0) / sizes.length : 0,
      maxSize: sizes.length > 0 ? Math.max(...sizes) : 0,
      minSize: sizes.length > 0 ? Math.min(...sizes) : 0,
      sizeDistribution: {
        small: sizes.filter(s => s < 1024).length,
        medium: sizes.filter(s => s >= 1024 && s < 10240).length,
        large: sizes.filter(s => s >= 10240 && s < 102400).length,
        xlarge: sizes.filter(s => s >= 102400).length
      }
    };

    return stats;
  }

  /**
   * Merge context data from multiple contexts
   */
  async mergeContexts(contextIds: string[]): Promise<Record<string, any>> {
    const contexts = await this.getMany(contextIds);
    const mergedData: Record<string, any> = {};

    contexts.forEach(context => {
      if (context) {
        Object.assign(mergedData, context.contextData);
      }
    });

    return mergedData;
  }

  /**
   * Get recent contexts for a provider
   */
  async getRecentByProvider(providerId: string, limit: number = 20): Promise<ProviderContextRecord[]> {
    const contexts = await this.getByProvider(providerId);
    return contexts
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  /**
   * Archive old contexts instead of deleting
   */
  async archiveOldContexts(olderThanDays: number = 90): Promise<number> {
    const cutoffDate = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    const allContexts = await this.getAll();
    
    const toArchive = allContexts.filter(context => 
      !context.isActive && 
      context.updatedAt < cutoffDate &&
      !context.metadata?.archived
    );

    const updates = toArchive.map(context => ({
      ...context,
      metadata: {
        ...context.metadata,
        archived: true,
        archivedAt: Date.now()
      },
      updatedAt: Date.now()
    }));

    if (updates.length > 0) {
      await this.putMany(updates);
    }

    return updates.length;
  }
}