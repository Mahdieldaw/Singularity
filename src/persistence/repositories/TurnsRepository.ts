// Turns Repository - Manages turn records

import { BaseRepository } from '../BaseRepository';
import { TurnRecord } from '../types';

export class TurnsRepository extends BaseRepository<TurnRecord> {
  constructor(db: IDBDatabase) {
    super(db, 'turns');
  }

  /**
   * Get turns by thread ID
   */
  async getByThreadId(threadId: string): Promise<TurnRecord[]> {
    const turns = await this.getByIndex('byThreadId', threadId);
    return turns.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  }

  /**
   * Get turns by session ID
   */
  async getBySessionId(sessionId: string): Promise<TurnRecord[]> {
    return this.getByIndex('bySessionId', sessionId);
  }

  /**
   * Get turns by user ID (scan fallback; no index)
   */
  async getByUserId(userId: string): Promise<TurnRecord[]> {
    const all = await this.getAll();
    return all.filter(t => t.userId === userId);
  }

  /**
   * Get turns by role (user/assistant) using type index
   */
  async getByRole(role: 'user' | 'assistant'): Promise<TurnRecord[]> {
    // Map role to stored type
    const type = role === 'assistant' ? 'ai' : 'user';
    return this.getByIndex('byType', type);
  }

  /**
   * Get turns created within a date range (scan fallback)
   */
  async getByDateRange(startDate: Date, endDate: Date): Promise<TurnRecord[]> {
    const start = startDate.getTime();
    const end = endDate.getTime();
    const all = await this.getAll();
    return all.filter(t => t.createdAt >= start && t.createdAt <= end);
  }

  /**
   * Get the latest turn in a thread
   */
  async getLatestByThreadId(threadId: string): Promise<TurnRecord | null> {
    const turns = await this.getByThreadId(threadId);
    return turns.length > 0 ? turns[turns.length - 1] : null;
  }

  /**
   * Get turns with pagination for a thread
   */
  async getByThreadIdPaginated(
    threadId: string,
    offset: number = 0,
    limit: number = 50
  ): Promise<{ turns: TurnRecord[]; hasMore: boolean }> {
    const result = await this.getPaginated('byThreadId', threadId, offset, limit);
    return {
      turns: result.records,
      hasMore: result.hasMore
    };
  }

  /**
   * Get next sequence number for a thread
   */
  async getNextSequence(threadId: string): Promise<number> {
    const turns = await this.getByThreadId(threadId);
    return turns.length > 0 ? Math.max(...turns.map(t => t.sequence || 0)) + 1 : 1;
  }

  /**
   * Search turns by content
   */
  async searchByContent(query: string, threadId?: string): Promise<TurnRecord[]> {
    const searchQuery = query.toLowerCase();
    let turns: TurnRecord[];

    if (threadId) {
      turns = await this.getByThreadId(threadId);
    } else {
      turns = await this.getAll();
    }

    return turns.filter(turn => 
      (turn.content || '').toLowerCase().includes(searchQuery)
    );
  }

  /**
   * Get conversation context (recent turns) for a thread
   */
  async getConversationContext(
    threadId: string, 
    maxTurns: number = 10
  ): Promise<TurnRecord[]> {
    const turns = await this.getByThreadId(threadId);
    return turns.slice(-maxTurns);
  }

  /**
   * Get turn statistics for a thread
   */
  async getThreadTurnStats(threadId: string): Promise<{
    total: number;
    userTurns: number;
    assistantTurns: number;
    averageLength: number;
    totalLength: number;
  }> {
    const turns = await this.getByThreadId(threadId);
    
    const stats = {
      total: turns.length,
      userTurns: turns.filter(t => (t.type === 'user')).length,
      assistantTurns: turns.filter(t => (t.type === 'ai')).length,
      averageLength: 0,
      totalLength: 0
    };

    stats.totalLength = turns.reduce((sum, turn) => sum + (turn.content || '').length, 0);
    stats.averageLength = stats.total > 0 ? stats.totalLength / stats.total : 0;

    return stats;
  }

  /**
   * Get user activity statistics
   */
  async getUserActivityStats(userId: string): Promise<{
    totalTurns: number;
    turnsToday: number;
    turnsThisWeek: number;
    averageTurnsPerDay: number;
    mostActiveThread: string | null;
  }> {
    const turns = await this.getByUserId(userId);
    
    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);

    const turnsToday = turns.filter(t => t.createdAt >= oneDayAgo).length;
    const turnsThisWeek = turns.filter(t => t.createdAt >= oneWeekAgo).length;

    // Find most active thread
    const threadCounts: Record<string, number> = {};
    turns.forEach(turn => {
      threadCounts[turn.threadId] = (threadCounts[turn.threadId] || 0) + 1;
    });

    const threadEntries = Object.entries(threadCounts);
    const mostActiveThread = threadEntries.length > 0
      ? threadEntries.reduce((a, b) => (a[1] > b[1] ? a : b))[0]
      : null;

    return {
      totalTurns: turns.length,
      turnsToday,
      turnsThisWeek,
      averageTurnsPerDay: turnsThisWeek / 7,
      mostActiveThread
    };
  }

  /**
   * Update turn content
   */
  async updateContent(turnId: string, content: string): Promise<void> {
    const turn = await this.get(turnId);
    if (turn) {
      turn.content = content;
      turn.updatedAt = Date.now();
      await this.put(turn);
    }
  }

  /**
   * Delete turns older than specified date for a thread
   */
  async deleteOldTurns(threadId: string, olderThanDate: Date): Promise<number> {
    const turns = await this.getByThreadId(threadId);
    const toDelete = turns.filter(turn => turn.createdAt < olderThanDate.getTime());
    
    if (toDelete.length > 0) {
      const ids = toDelete.map(turn => turn.id);
      await this.deleteMany(ids);
    }

    return toDelete.length;
  }

  /**
   * Get turns by provider responses (turns that have provider responses)
   */
  async getTurnsWithProviderResponses(): Promise<TurnRecord[]> {
    const allTurns = await this.getAll();
    return allTurns.filter(turn => 
      turn.providerResponseIds && turn.providerResponseIds.length > 0
    );
  }

  /**
   * Get conversation flow for a thread (alternating user/assistant pattern)
   */
  async getConversationFlow(threadId: string): Promise<{
    turns: TurnRecord[];
    isValidFlow: boolean;
    issues: string[];
  }> {
    const turns = await this.getByThreadId(threadId);
    const issues: string[] = [];
    
    // Check for proper alternating pattern
    let expectedRole: 'user' | 'assistant' = 'user';
    let isValidFlow = true;

    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      
      const currentRole: 'user' | 'assistant' = (turn.type === 'ai') ? 'assistant' : 'user';
      if (currentRole !== expectedRole) {
        isValidFlow = false;
        issues.push(`Turn ${i + 1}: Expected ${expectedRole}, got ${currentRole}`);
      }
      
      // Check sequence numbers
      if (turn.sequence !== i + 1) {
        isValidFlow = false;
        issues.push(`Turn ${i + 1}: Sequence mismatch (expected ${i + 1}, got ${turn.sequence})`);
      }
      
      expectedRole = expectedRole === 'user' ? 'assistant' : 'user';
    }

    return {
      turns,
      isValidFlow,
      issues
    };
  }
}