// Provider Responses Repository - Manages provider response records

import { BaseRepository } from '../BaseRepository';
import { ProviderResponseRecord } from '../types';

export class ProviderResponsesRepository extends BaseRepository<ProviderResponseRecord> {
  constructor(db: IDBDatabase) {
    super(db, 'provider_responses');
  }

  /**
   * Get responses by AI turn ID
   */
  async getByTurnId(turnId: string): Promise<ProviderResponseRecord[]> {
    return this.getByIndex('byAiTurnId', turnId);
  }

  /**
   * Get responses by providerId
   */
  async getByProvider(providerId: string): Promise<ProviderResponseRecord[]> {
    return this.getByIndex('byProviderId', providerId);
  }

  /**
   * Get responses by session ID (scan fallback; no direct index)
   */
  async getBySessionId(sessionId: string): Promise<ProviderResponseRecord[]> {
    const all = await this.getAll();
    return all.filter(r => r.sessionId === sessionId);
  }

  /**
   * Get responses by status (scan fallback; no index)
   */
  async getByStatus(status: 'pending' | 'completed' | 'error' | 'cancelled' | 'streaming'): Promise<ProviderResponseRecord[]> {
    const all = await this.getAll();
    return all.filter(r => r.status === status);
  }

  /**
   * Get responses created within a date range (scan fallback)
   */
  async getByDateRange(startDate: Date, endDate: Date): Promise<ProviderResponseRecord[]> {
    const start = startDate.getTime();
    const end = endDate.getTime();
    const all = await this.getAll();
    return all.filter(r => r.createdAt >= start && r.createdAt <= end);
  }

  /**
   * Get pending responses
   */
  async getPendingResponses(): Promise<ProviderResponseRecord[]> {
    return this.getByStatus('pending');
  }

  /**
   * Get failed responses
   */
  async getFailedResponses(): Promise<ProviderResponseRecord[]> {
    return this.getByStatus('error');
  }

  /**
   * Get responses by provider and status
   */
  async getByProviderAndStatus(
    providerId: string, 
    status: 'pending' | 'completed' | 'error' | 'cancelled' | 'streaming'
  ): Promise<ProviderResponseRecord[]> {
    const allResponses = await this.getByProvider(providerId);
    return allResponses.filter((r: ProviderResponseRecord) => r.status === status);
  }

  /**
   * Update response status
   */
  async updateStatus(
    responseId: string, 
    status: 'pending' | 'completed' | 'error' | 'cancelled' | 'streaming',
    error?: string
  ): Promise<void> {
    const response = await this.get(responseId);
    if (response) {
      response.status = status;
      response.updatedAt = Date.now();
      
      if (status === 'completed') {
        response.completedAt = Date.now();
      }
      
      if (error) {
        response.error = error;
      }
      
      await this.put(response);
    }
  }

  /**
   * Update response content
   */
  async updateContent(responseId: string, content: string): Promise<void> {
    const response = await this.get(responseId);
    if (response) {
      response.content = content;
      response.updatedAt = Date.now();
      await this.put(response);
    }
  }

  /**
   * Get provider performance statistics
   */
  async getProviderStats(providerId?: string): Promise<{
    totalResponses: number;
    completedResponses: number;
    failedResponses: number;
    averageResponseTime: number;
    successRate: number;
    byProvider?: Record<string, {
      total: number;
      completed: number;
      failed: number;
      successRate: number;
    }>;
  }> {
    let responses: ProviderResponseRecord[];
    
    if (providerId) {
      responses = await this.getByProvider(providerId);
    } else {
      responses = await this.getAll();
    }

    const completed = responses.filter((r: ProviderResponseRecord) => r.status === 'completed');
    const failed = responses.filter((r: ProviderResponseRecord) => r.status === 'error');
    
    // Calculate average response time for completed responses
    const responseTimes = completed
      .filter((r: ProviderResponseRecord) => r.completedAt)
      .map((r: ProviderResponseRecord) => r.completedAt! - r.createdAt);
    
    const averageResponseTime = responseTimes.length > 0 
      ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length 
      : 0;

    const stats = {
      totalResponses: responses.length,
      completedResponses: completed.length,
      failedResponses: failed.length,
      averageResponseTime,
      successRate: responses.length > 0 ? completed.length / responses.length : 0
    };

    // If no specific provider, include breakdown by provider
    if (!providerId) {
      const byProvider: Record<string, any> = {};
      const providers = Array.from(new Set(responses.map((r: ProviderResponseRecord) => r.providerId)));
      
      for (const p of providers) {
        const providerResponses = responses.filter((r: ProviderResponseRecord) => r.providerId === p);
        const providerCompleted = providerResponses.filter((r: ProviderResponseRecord) => r.status === 'completed');
        const providerFailed = providerResponses.filter((r: ProviderResponseRecord) => r.status === 'error');
        
        byProvider[p] = {
          total: providerResponses.length,
          completed: providerCompleted.length,
          failed: providerFailed.length,
          successRate: providerResponses.length > 0 ? providerCompleted.length / providerResponses.length : 0
        };
      }
      
      (stats as any).byProvider = byProvider;
    }

    return stats;
  }

  /**
   * Get recent responses for a provider
   */
  async getRecentByProvider(providerId: string, limit: number = 20): Promise<ProviderResponseRecord[]> {
    const responses = await this.getByProvider(providerId);
    return responses
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  /**
   * Search responses by content
   */
  async searchByContent(query: string, providerId?: string): Promise<ProviderResponseRecord[]> {
    const searchQuery = query.toLowerCase();
    let responses: ProviderResponseRecord[];

    if (providerId) {
      responses = await this.getByProvider(providerId);
    } else {
      responses = await this.getAll();
    }

    return responses.filter(response => 
      response.content && response.content.toLowerCase().includes(searchQuery)
    );
  }

  /**
   * Get responses with high token usage
   */
  async getHighTokenUsageResponses(minTokens: number = 1000): Promise<ProviderResponseRecord[]> {
    const allResponses = await this.getAll();
    return allResponses.filter(response => 
      response.tokenUsage && 
      (response.tokenUsage.promptTokens + response.tokenUsage.completionTokens) >= minTokens
    );
  }

  /**
   * Get token usage statistics
   */
  async getTokenUsageStats(providerId?: string): Promise<{
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    averageTokensPerResponse: number;
    responseCount: number;
  }> {
    let responses: ProviderResponseRecord[];
    
    if (providerId) {
      responses = await this.getByProvider(providerId);
    } else {
      responses = await this.getAll();
    }

    const responsesWithTokens = responses.filter(r => r.tokenUsage);
    
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    
    responsesWithTokens.forEach(response => {
      if (response.tokenUsage) {
        totalPromptTokens += response.tokenUsage.promptTokens;
        totalCompletionTokens += response.tokenUsage.completionTokens;
      }
    });

    const totalTokens = totalPromptTokens + totalCompletionTokens;

    return {
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      averageTokensPerResponse: responsesWithTokens.length > 0 ? totalTokens / responsesWithTokens.length : 0,
      responseCount: responsesWithTokens.length
    };
  }

  /**
   * Clean up old failed responses
   */
  async cleanupFailedResponses(olderThanDays: number = 7): Promise<number> {
    const cutoffDate = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    const failedResponses = await this.getFailedResponses();
    
    const toDelete = failedResponses.filter((response: ProviderResponseRecord) =>
      response.createdAt < cutoffDate
    );

    if (toDelete.length > 0) {
      const ids = toDelete.map((response: ProviderResponseRecord) => response.id);
      await this.deleteMany(ids);
    }

    return toDelete.length;
  }

  /**
   * Get responses by turn with provider comparison
   */
  async getProviderComparisonForTurn(turnId: string): Promise<{
    responses: ProviderResponseRecord[];
    providers: string[];
    completedCount: number;
    pendingCount: number;
  }> {
    const responses = await this.getByTurnId(turnId);
    const providers = Array.from(new Set(responses.map((r: ProviderResponseRecord) => r.providerId)));
    
    return {
      responses: responses.sort((a: ProviderResponseRecord, b: ProviderResponseRecord) => a.createdAt - b.createdAt),
      providers,
      completedCount: responses.filter((r: ProviderResponseRecord) => r.status === 'completed').length,
      pendingCount: responses.filter((r: ProviderResponseRecord) => r.status === 'pending').length
    };
  }

  /**
   * Get response by compound key (for compatibility)
   */
  async getByCompoundKey(key: string): Promise<ProviderResponseRecord | null> {
    // Assuming the compound key is the response ID
    return this.get(key);
  }

  /**
   * Update response metadata
   */
  async updateMetadata(responseId: string, metadata: Record<string, any>): Promise<void> {
    const response = await this.get(responseId);
    if (response) {
      response.metadata = { ...response.metadata, ...metadata };
      response.updatedAt = Date.now();
      await this.put(response);
    }
  }
}