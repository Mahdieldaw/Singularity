import { SimpleIndexedDBAdapter } from '../persistence/SimpleIndexedDBAdapter';
import type { ProvenanceData } from '../../ui/components/composer/extensions/ComposedContentNode';
import type { TurnRecord, ProviderResponseRecord } from '../persistence/types';

export class ContextGraphService {
  private adapter: SimpleIndexedDBAdapter;

  constructor(adapter: SimpleIndexedDBAdapter) {
    this.adapter = adapter;
  }

  /**
   * HIGH-PERFORMANCE: Uses compound index for O(1) lookup
   */
  async getContextByProvenance(provenance: ProvenanceData): Promise<ProviderResponseRecord | null> {
    if (!this.adapter.isReady()) {
      console.warn('[ContextGraph] Adapter not ready');
      return null;
    }

    const { aiTurnId, providerId, responseType, responseIndex } = provenance;

    // Validate inputs
    if (!aiTurnId || !providerId || !responseType) {
      console.warn('[ContextGraph] Invalid provenance:', provenance);
      return null;
    }

    try {
      // Use the existing byCompoundKey index for O(1) lookup
      const responses = await this.adapter.getByIndex(
        'provider_responses',
        'byCompoundKey',
        [aiTurnId, providerId, responseType, responseIndex ?? 0]
      );

      if (!responses || responses.length === 0) {
        console.warn(`[ContextGraph] No response found for provenance:`, provenance);
        return null;
      }

      // Should return exactly one match due to unique constraint
      return responses[0] as ProviderResponseRecord;
    } catch (error) {
      console.error('[ContextGraph] getContextByProvenance failed:', error);
      return null;
    }
  }

  /**
   * OPTIMIZED: Early-exit search with recency sorting
   */
  async searchChatHistory(
    sessionId: string,
    query: string,
    limit: number = 20
  ): Promise<TurnRecord[]> {
    if (!this.adapter.isReady()) {
      console.warn('[ContextGraph] Adapter not ready');
      return [];
    }

    try {
      const lowerQuery = query.toLowerCase();
      const matches: TurnRecord[] = [];

      // Get turns using indexed query (fast)
      const turns = await this.adapter.getTurnsBySessionId(sessionId);

      // Sort by recency (most recent first)
      turns.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

      // Early exit when we have enough matches
      for (const turn of turns) {
        if (matches.length >= limit) break;

        const content = String(turn.content || '').toLowerCase();
        if (content.includes(lowerQuery)) {
          matches.push(turn as TurnRecord);
        }
      }

      return matches;
    } catch (error) {
      console.error('[ContextGraph] searchChatHistory failed:', error);
      return [];
    }
  }

  /**
   * Direct turn lookup by ID (already O(1))
   */
  async getTurnById(turnId: string): Promise<TurnRecord | undefined> {
    if (!this.adapter.isReady()) return undefined;
    return this.adapter.get('turns', turnId) as Promise<TurnRecord | undefined>;
  }

  /**
   * Get recent turns (useful for "what did we just discuss?")
   */
  async getRecentTurns(sessionId: string, limit: number = 10): Promise<TurnRecord[]> {
    if (!this.adapter.isReady()) return [];

    try {
      const turns = await this.adapter.getTurnsBySessionId(sessionId);
      turns.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      return turns.slice(0, limit) as TurnRecord[];
    } catch (error) {
      console.error('[ContextGraph] getRecentTurns failed:', error);
      return [];
    }
  }
}