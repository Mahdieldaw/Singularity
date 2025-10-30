// Sessions Repository - Manages session records

import { BaseRepository } from '../BaseRepository';
import { SessionRecord } from '../types';

export class SessionsRepository extends BaseRepository<SessionRecord> {
  constructor(db: IDBDatabase) {
    super(db, 'sessions');
  }

  /**
   * Get sessions by user ID
   */
  async getByUserId(userId: string): Promise<SessionRecord[]> {
    const all = await this.getAll();
    return all.filter(session => session.userId === userId);
  }

  /**
   * Get active sessions for a user
   */
  async getActiveByUserId(userId: string): Promise<SessionRecord[]> {
    const sessions = await this.getByUserId(userId);
    return sessions.filter(session => session.isActive);
  }

  /**
   * Get sessions created within a date range
   */
  async getByDateRange(startDate: Date, endDate: Date): Promise<SessionRecord[]> {
    const range = IDBKeyRange.bound(startDate.getTime(), endDate.getTime());
    return this.getByIndex('byCreatedAt', range);
  }

  /**
   * Get sessions by provider
   */
  async getByProvider(provider: string): Promise<SessionRecord[]> {
    const all = await this.getAll();
    return all.filter(session => session.provider === provider);
  }

  /**
   * Get recent sessions for a user (limited)
   */
  async getRecentByUserId(userId: string, limit: number = 10): Promise<SessionRecord[]> {
    const sessions = await this.getByUserId(userId);
    return sessions
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  /**
   * Update session activity status
   */
  async updateActivity(sessionId: string, isActive: boolean): Promise<void> {
    const session = await this.get(sessionId);
    if (session) {
      session.isActive = isActive;
      session.updatedAt = Date.now();
      await this.put(session);
    }
  }

  /**
   * Get session statistics for a user
   */
  async getSessionStats(userId: string): Promise<{
    total: number;
    active: number;
    byProvider: Record<string, number>;
  }> {
    const sessions = await this.getByUserId(userId);
    
    const stats = {
      total: sessions.length,
      active: sessions.filter(s => s.isActive).length,
      byProvider: {} as Record<string, number>
    };

    sessions.forEach(session => {
      if (session.provider) {
        stats.byProvider[session.provider] = (stats.byProvider[session.provider] || 0) + 1;
      }
    });

    return stats;
  }

  /**
   * Deactivate all sessions for a user
   */
  async deactivateAllForUser(userId: string): Promise<void> {
    const sessions = await this.getActiveByUserId(userId);
    const updates = sessions.map(session => ({
      ...session,
      isActive: false,
      updatedAt: Date.now()
    }));
    
    if (updates.length > 0) {
      await this.putMany(updates);
    }
  }

  /**
   * Clean up old inactive sessions
   */
  async cleanupOldSessions(olderThanDays: number = 30): Promise<number> {
    // Defensive readiness check: ensure store exists
    if (!this.db || !Array.from(this.db.objectStoreNames).includes(this.storeName)) {
      console.warn(`[SessionsRepository] Store ${this.storeName} not available; skipping cleanup`);
      return 0;
    }
    try {
      const cutoffDate = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
      const allSessions = await this.getAll();
      const toDelete = allSessions.filter(session => 
        !session.isActive && session.updatedAt < cutoffDate
      );

      if (toDelete.length > 0) {
        const ids = toDelete.map(session => session.id);
        await this.deleteMany(ids);
      }

      return toDelete.length;
    } catch (error) {
      if (error instanceof Error && (error.name === 'NotFoundError' || error.message?.includes('Missing object stores'))) {
        console.warn('[SessionsRepository] Cleanup aborted due to missing store or NotFoundError:', error);
        return 0;
      }
      console.error('[SessionsRepository] Cleanup failed:', error);
      return 0;
    }
  }
}