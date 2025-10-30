// Threads Repository - Manages thread records

import { BaseRepository } from '../BaseRepository';
import { ThreadRecord } from '../types';

export class ThreadsRepository extends BaseRepository<ThreadRecord> {
  constructor(db: IDBDatabase) {
    super(db, 'threads');
  }

  /**
   * Get threads by session ID
   */
  async getBySessionId(sessionId: string): Promise<ThreadRecord[]> {
    return this.getByIndex('bySessionId', sessionId);
  }

  /**
   * Get threads by user ID
   */
  async getByUserId(userId: string): Promise<ThreadRecord[]> {
    const all = await this.getAll();
    return all.filter(thread => thread.userId === userId);
  }

  /**
   * Get active threads for a session
   */
  async getActiveBySessionId(sessionId: string): Promise<ThreadRecord[]> {
    const threads = await this.getBySessionId(sessionId);
    return threads.filter(thread => thread.isActive);
  }

  /**
   * Get threads created within a date range
   */
  async getByDateRange(startDate: Date, endDate: Date): Promise<ThreadRecord[]> {
    const start = startDate.getTime();
    const end = endDate.getTime();
    const all = await this.getAll();
    return all.filter(thread => thread.createdAt >= start && thread.createdAt <= end);
  }

  /**
   * Get threads by title (partial match)
   */
  async searchByTitle(titleQuery: string): Promise<ThreadRecord[]> {
    const allThreads = await this.getAll();
    const query = titleQuery.toLowerCase();
    
    return allThreads.filter(thread => 
      thread.title.toLowerCase().includes(query)
    );
  }

  /**
   * Get recent threads for a user (limited)
   */
  async getRecentByUserId(userId: string, limit: number = 20): Promise<ThreadRecord[]> {
    const threads = await this.getByUserId(userId);
    return threads
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  /**
   * Update thread activity status
   */
  async updateActivity(threadId: string, isActive: boolean): Promise<void> {
    const thread = await this.get(threadId);
    if (thread) {
      thread.isActive = isActive;
      thread.updatedAt = Date.now();
      await this.put(thread);
    }
  }

  /**
   * Update thread title
   */
  async updateTitle(threadId: string, title: string): Promise<void> {
    const thread = await this.get(threadId);
    if (thread) {
      thread.title = title;
      thread.updatedAt = Date.now();
      await this.put(thread);
    }
  }

  /**
   * Get thread statistics for a user
   */
  async getThreadStats(userId: string): Promise<{
    total: number;
    active: number;
    bySessions: Record<string, number>;
    averageTurns: number;
  }> {
    const threads = await this.getByUserId(userId);
    
    const stats = {
      total: threads.length,
      active: threads.filter(t => t.isActive).length,
      bySessions: {} as Record<string, number>,
      averageTurns: 0
    };

    let totalTurns = 0;
    threads.forEach(thread => {
      stats.bySessions[thread.sessionId] = (stats.bySessions[thread.sessionId] || 0) + 1;
      totalTurns += thread.turnCount || 0;
    });

    stats.averageTurns = threads.length > 0 ? totalTurns / threads.length : 0;

    return stats;
  }

  /**
   * Increment turn count for a thread
   */
  async incrementTurnCount(threadId: string): Promise<void> {
    const thread = await this.get(threadId);
    if (thread) {
      thread.turnCount = (thread.turnCount || 0) + 1;
      thread.updatedAt = Date.now();
      await this.put(thread);
    }
  }

  /**
   * Get threads with high turn counts (active conversations)
   */
  async getActiveConversations(minTurns: number = 5): Promise<ThreadRecord[]> {
    const allThreads = await this.getAll();
    return allThreads
      .filter(thread => thread.isActive && (thread.turnCount || 0) >= minTurns)
      .sort((a, b) => (b.turnCount || 0) - (a.turnCount || 0));
  }

  /**
   * Archive old inactive threads
   */
  async archiveOldThreads(olderThanDays: number = 90): Promise<number> {
    const cutoffDate = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    const allThreads = await this.getAll();
    
    const toArchive = allThreads.filter(thread => 
      !thread.isActive && thread.updatedAt < cutoffDate
    );

    // Mark as archived instead of deleting
    const updates = toArchive.map(thread => ({
      ...thread,
      metadata: {
        ...thread.metadata,
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

  /**
   * Get threads by session with pagination
   */
  async getBySessionIdPaginated(
    sessionId: string, 
    offset: number = 0, 
    limit: number = 20
  ): Promise<{ threads: ThreadRecord[]; hasMore: boolean }> {
    const result = await this.getPaginated('bySessionId', sessionId, offset, limit);
    return {
      threads: result.records,
      hasMore: result.hasMore
    };
  }
}