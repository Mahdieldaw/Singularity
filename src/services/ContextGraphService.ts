import { SimpleIndexedDBAdapter } from '../persistence/SimpleIndexedDBAdapter';
import type { TurnRecord } from '../persistence/types';

/**
 * Simple context provider for the Scratchpad agent.
 * Reads turn digests and provides them as context.
 */
export class ContextGraphService {
  private adapter: SimpleIndexedDBAdapter;

  constructor(adapter: SimpleIndexedDBAdapter) {
    this.adapter = adapter;
  }

  /**
   * Get all turns for a session with their digests
   * Returns turns sorted by creation time
   */
  async getTurnsWithDigests(sessionId: string): Promise<TurnRecord[]> {
    if (!this.adapter.isReady()) {
      console.warn('[ContextGraph] Adapter not ready');
      return [];
    }

    try {
      const turns = await this.adapter.getTurnsBySessionId(sessionId);
      
      // Sort by creation time (oldest first)
      turns.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
      
      return turns as TurnRecord[];
    } catch (error) {
      console.error('[ContextGraph] getTurnsWithDigests failed:', error);
      return [];
    }
  }

  /**
   * Build a context string from turn digests
   * This is what we'll send to the agent as "conversation memory"
   */
  buildContextFromDigests(turns: TurnRecord[]): string {
    const lines: string[] = [];
    
    lines.push('CONVERSATION HISTORY:');
    lines.push('');

    turns.forEach((turn, index) => {
      if (turn.type === 'user') {
        const content = String(turn.content || '');
        lines.push(`[Turn ${index + 1}] User: ${content.slice(0, 200)}`);
      } else if (turn.type === 'ai') {
        const aiTurn = turn as any;
        
        // If digest exists, use it
        if (typeof aiTurn.digest === 'string' && aiTurn.digest.trim().length > 0) {
          lines.push(`[Turn ${index + 1}] AI: ${aiTurn.digest}`);
        } else if (aiTurn.digest?.summary) {
          lines.push(`[Turn ${index + 1}] AI: ${aiTurn.digest.summary}`);
          if (aiTurn.digest.keyPoints?.length > 0) {
            lines.push(`  Key points: ${aiTurn.digest.keyPoints.join(', ')}`);
          }
        } else {
          // Fallback: use batch responses preview
          const batchResponses = Object.values(aiTurn.batchResponses || {});
          if (batchResponses.length > 0) {
            const firstResponse = batchResponses[0] as any;
            const preview = String(firstResponse?.text || '').slice(0, 150);
            lines.push(`[Turn ${index + 1}] AI: ${preview}...`);
          }
        }
      }
      lines.push('');
    });

    return lines.join('\n');
  }
}