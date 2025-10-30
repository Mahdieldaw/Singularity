// Provenance Query Helpers - Complex cross-store queries for data lineage and relationships

import type { SimpleIndexedDBAdapter } from '../SimpleIndexedDBAdapter.js';
import type {
  SessionRecord,
  ThreadRecord,
  TurnRecord,
  ProviderResponseRecord,
  DocumentRecord,
  CanvasBlockRecord,
  GhostRecord,
  ProviderContextRecord,
  MetadataRecord
} from '../types';

/**
 * Provenance trace result containing the full lineage of an entity
 */
export interface ProvenanceTrace {
  /** Root entity being traced */
  entity: {
    id: string;
    type: string;
    data: any;
  };
  /** Parent entities in the hierarchy */
  parents: Array<{
    id: string;
    type: string;
    relationship: string;
    data: any;
  }>;
  /** Child entities in the hierarchy */
  children: Array<{
    id: string;
    type: string;
    relationship: string;
    data: any;
  }>;
  /** Related entities (siblings, references, etc.) */
  related: Array<{
    id: string;
    type: string;
    relationship: string;
    data: any;
  }>;
  /** Historical changes from ghosts */
  history: Array<{
    timestamp: number;
    operation: string;
    changes: any;
    metadata?: any;
  }>;
}

/**
 * Session lineage including all related entities
 */
export interface SessionLineage {
  session: SessionRecord;
  threads: ThreadRecord[];
  turns: TurnRecord[];
  providerResponses: ProviderResponseRecord[];
  documents: DocumentRecord[];
  canvasBlocks: CanvasBlockRecord[];
  providerContexts: ProviderContextRecord[];
  metadata: MetadataRecord[];
  totalEntities: number;
}

/**
 * Cross-reference result showing relationships between entities
 */
export interface CrossReference {
  sourceEntity: { id: string; type: string };
  targetEntity: { id: string; type: string };
  relationship: string;
  strength: number; // 0-1, how strong the relationship is
  metadata?: any;
}

/**
 * Activity timeline entry
 */
export interface ActivityEntry {
  timestamp: number;
  entityId: string;
  entityType: string;
  operation: string;
  userId?: string;
  sessionId?: string;
  threadId?: string;
  metadata?: any;
}

/**
 * Provenance query helper class
 */
export class ProvenanceQueries {
  constructor(private adapter: SimpleIndexedDBAdapter) {}

  /**
   * Get complete provenance trace for any entity
   */
  async getProvenanceTrace(entityId: string, entityType: string): Promise<ProvenanceTrace> {
    const trace: ProvenanceTrace = {
      entity: { id: entityId, type: entityType, data: null },
      parents: [],
      children: [],
      related: [],
      history: []
    };

    // Get the main entity
    trace.entity.data = await this.getEntityById(entityId, entityType);
    if (!trace.entity.data) {
      throw new Error(`Entity ${entityId} of type ${entityType} not found`);
    }

    // Get historical changes
    const allGhosts = await this.adapter.getAll('ghosts') as GhostRecord[];
    const ghosts = allGhosts.filter(ghost => ghost.entityId === entityId);
    trace.history = ghosts
      .filter(ghost => ghost.timestamp !== undefined && ghost.operation !== undefined)
      .map(ghost => ({
        timestamp: ghost.timestamp!,
        operation: ghost.operation!,
        changes: ghost.state,
        metadata: ghost.metadata
      })).sort((a, b) => b.timestamp - a.timestamp);

    // Build relationships based on entity type
    switch (entityType) {
      case 'session':
        await this.buildSessionProvenance(trace, trace.entity.data as SessionRecord);
        break;
      case 'thread':
        await this.buildThreadProvenance(trace, trace.entity.data as ThreadRecord);
        break;
      case 'turn':
        await this.buildTurnProvenance(trace, trace.entity.data as TurnRecord);
        break;
      case 'document':
        await this.buildDocumentProvenance(trace, trace.entity.data as DocumentRecord);
        break;
      case 'canvasBlock':
        await this.buildCanvasBlockProvenance(trace, trace.entity.data as CanvasBlockRecord);
        break;
      default:
        // Generic provenance for other types
        await this.buildGenericProvenance(trace, entityId, entityType);
    }

    return trace;
  }

  /**
   * Get complete session lineage with all related entities
   */
  async getSessionLineage(sessionId: string): Promise<SessionLineage> {
    const session = await this.adapter.get('sessions', sessionId) as SessionRecord;
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const [allThreads, allDocuments, allProviderContexts, allMetadata] = await Promise.all([
      this.adapter.getAll('threads') as Promise<ThreadRecord[]>,
      this.adapter.getAll('documents') as Promise<DocumentRecord[]>,
      this.adapter.getAll('providerContexts') as Promise<ProviderContextRecord[]>,
      this.adapter.getAll('metadata') as Promise<MetadataRecord[]>
    ]);

    const threads = allThreads.filter(thread => thread.sessionId === sessionId);
    const documents = allDocuments.filter(doc => doc.sessionId === sessionId || doc.sourceSessionId === sessionId);
    const providerContexts = allProviderContexts.filter(context => context.sessionId === sessionId);
    const metadata = allMetadata.filter(meta => meta.entityId === sessionId);

    // Get all turns for all threads
    const allTurns: TurnRecord[] = [];
    const allProviderResponses: ProviderResponseRecord[] = [];
    
    const [allTurnsData, allResponsesData] = await Promise.all([
      this.adapter.getAll('turns') as Promise<TurnRecord[]>,
      this.adapter.getAll('providerResponses') as Promise<ProviderResponseRecord[]>
    ]);
    
    for (const thread of threads) {
      const threadTurns = allTurnsData.filter(turn => turn.threadId === thread.id);
      allTurns.push(...threadTurns);
      
      for (const turn of threadTurns) {
        const responses = allResponsesData.filter(response => response.aiTurnId === turn.id);
        allProviderResponses.push(...responses);
      }
    }

    // Get all canvas blocks for all documents
    const allCanvasBlocks: CanvasBlockRecord[] = [];
    const allBlocksData = await this.adapter.getAll('canvasBlocks') as CanvasBlockRecord[];
    for (const document of documents) {
      const blocks = allBlocksData.filter(block => block.documentId === document.id);
      allCanvasBlocks.push(...blocks);
    }

    const totalEntities = 1 + threads.length + allTurns.length + allProviderResponses.length + 
                         documents.length + allCanvasBlocks.length + providerContexts.length + metadata.length;

    return {
      session,
      threads,
      turns: allTurns,
      providerResponses: allProviderResponses,
      documents,
      canvasBlocks: allCanvasBlocks,
      providerContexts,
      metadata,
      totalEntities
    };
  }

  /**
   * Find cross-references between entities
   */
  async findCrossReferences(entityId: string, entityType: string): Promise<CrossReference[]> {
    const references: CrossReference[] = [];

    // Find direct references in other entities
    switch (entityType) {
      case 'session':
        // Find threads, documents, contexts that reference this session
        const [allThreads, allDocuments, allProviderContexts] = await Promise.all([
          this.adapter.getAll('threads') as Promise<ThreadRecord[]>,
          this.adapter.getAll('documents') as Promise<DocumentRecord[]>,
          this.adapter.getAll('providerContexts') as Promise<ProviderContextRecord[]>
        ]);

        const sessionThreads = allThreads.filter(thread => thread.sessionId === entityId);
        const sessionDocs = allDocuments.filter(doc => doc.sessionId === entityId || doc.sourceSessionId === entityId);
        const sessionContexts = allProviderContexts.filter(context => context.sessionId === entityId);

        sessionThreads.forEach(thread => {
          references.push({
            sourceEntity: { id: entityId, type: 'session' },
            targetEntity: { id: thread.id, type: 'thread' },
            relationship: 'contains',
            strength: 1.0
          });
        });

        sessionDocs.forEach(doc => {
          references.push({
            sourceEntity: { id: entityId, type: 'session' },
            targetEntity: { id: doc.id, type: 'document' },
            relationship: 'contains',
            strength: 1.0
          });
        });

        sessionContexts.forEach(context => {
          references.push({
            sourceEntity: { id: entityId, type: 'session' },
            targetEntity: { id: context.id, type: 'providerContext' },
            relationship: 'uses',
            strength: 0.8
          });
        });
        break;

      case 'thread':
        // Find turns that belong to this thread
        const allTurns = await this.adapter.getAll('turns') as TurnRecord[];
        const turns = allTurns.filter(turn => turn.threadId === entityId);
        turns.forEach(turn => {
          references.push({
            sourceEntity: { id: entityId, type: 'thread' },
            targetEntity: { id: turn.id, type: 'turn' },
            relationship: 'contains',
            strength: 1.0
          });
        });
        break;

      case 'turn':
        // Find provider responses for this turn
        const allResponses = await this.adapter.getAll('providerResponses') as ProviderResponseRecord[];
        const responses = allResponses.filter(response => response.aiTurnId === entityId);
        responses.forEach(response => {
          references.push({
            sourceEntity: { id: entityId, type: 'turn' },
            targetEntity: { id: response.id, type: 'providerResponse' },
            relationship: 'generates',
            strength: 1.0
          });
        });
        break;

      case 'document':
        // Find canvas blocks that belong to this document
        const allBlocks = await this.adapter.getAll('canvasBlocks') as CanvasBlockRecord[];
        const blocks = allBlocks.filter(block => block.documentId === entityId);
        blocks.forEach(block => {
          references.push({
            sourceEntity: { id: entityId, type: 'document' },
            targetEntity: { id: block.id, type: 'canvasBlock' },
            relationship: 'contains',
            strength: 1.0
          });
        });
        break;
    }

    // Find metadata references
    const allMetadata = await this.adapter.getAll('metadata') as MetadataRecord[];
    const metadata = allMetadata.filter(meta => meta.entityId === entityId);
    metadata.forEach(meta => {
      references.push({
        sourceEntity: { id: entityId, type: entityType },
        targetEntity: { id: meta.id, type: 'metadata' },
        relationship: 'hasMetadata',
        strength: 0.6
      });
    });

    return references;
  }

  /**
   * Get activity timeline for a session or user
   */
  async getActivityTimeline(
    filter: { sessionId?: string; userId?: string; threadId?: string },
    limit: number = 100
  ): Promise<ActivityEntry[]> {
    const activities: ActivityEntry[] = [];

    // Collect activities from ghosts (change history)
    let ghosts: GhostRecord[] = [];
    const allGhosts = await this.adapter.getAll('ghosts') as GhostRecord[];
    
    if (filter.sessionId) {
      ghosts = allGhosts.filter(ghost => ghost.sessionId === filter.sessionId);
    } else if (filter.userId) {
      // Get recent sessions for the user and then get ghosts
      const allSessions = await this.adapter.getAll('sessions') as SessionRecord[];
      const recentSessions = allSessions
        .filter(session => session.userId === filter.userId)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 10);
      if (recentSessions.length > 0) {
        ghosts = allGhosts
          .filter(ghost => ghost.sessionId === recentSessions[0].id)
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
          .slice(0, limit * 2);
      }
    } else {
      // Get all sessions and pick the most recent one
      const allSessions = await this.adapter.getAll('sessions') as SessionRecord[];
      const sortedSessions = allSessions.sort((a, b) => b.updatedAt - a.updatedAt);
      if (sortedSessions.length > 0) {
        ghosts = allGhosts
          .filter(ghost => ghost.sessionId === sortedSessions[0].id)
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
          .slice(0, limit * 2);
      }
    }

    // Convert ghosts to activity entries
    ghosts
      .filter(ghost => ghost.timestamp !== undefined && ghost.operation !== undefined && ghost.entityId !== undefined && ghost.entityType !== undefined)
      .forEach(ghost => {
        activities.push({
          timestamp: ghost.timestamp!,
          entityId: ghost.entityId!,
          entityType: ghost.entityType!,
          operation: ghost.operation!,
          sessionId: ghost.sessionId,
          metadata: ghost.metadata
        });
      });

    // Add creation activities from main entities
    if (filter.sessionId) {
      const [allThreads, allTurns, allDocuments] = await Promise.all([
        this.adapter.getAll('threads') as Promise<ThreadRecord[]>,
        this.adapter.getAll('turns') as Promise<TurnRecord[]>,
        this.adapter.getAll('documents') as Promise<DocumentRecord[]>
      ]);

      const threads = allThreads.filter(thread => thread.sessionId === filter.sessionId);
      const turns = allTurns.filter(turn => turn.sessionId === filter.sessionId);
      const documents = allDocuments.filter(doc => doc.sessionId === filter.sessionId || doc.sourceSessionId === filter.sessionId);

      // Add thread creations
      threads.forEach(thread => {
        activities.push({
          timestamp: thread.createdAt,
          entityId: thread.id,
          entityType: 'thread',
          operation: 'create',
          sessionId: thread.sessionId
        });
      });

      // Add turn creations
      turns.forEach(turn => {
        activities.push({
          timestamp: turn.createdAt,
          entityId: turn.id,
          entityType: 'turn',
          operation: 'create',
          sessionId: turn.sessionId,
          threadId: turn.threadId
        });
      });

      // Add document creations
      documents.forEach(doc => {
        activities.push({
          timestamp: doc.createdAt,
          entityId: doc.id,
          entityType: 'document',
          operation: 'create',
          sessionId: doc.sessionId || doc.sourceSessionId || ''
        });
      });
    }

    // Sort by timestamp (newest first) and limit
    return activities
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Find orphaned entities (entities without proper parent relationships)
   */
  async findOrphanedEntities(): Promise<Array<{ id: string; type: string; reason: string }>> {
    const orphans: Array<{ id: string; type: string; reason: string }> = [];

    const [allThreads, allTurns, allResponses, allBlocks, allSessions, allDocuments] = await Promise.all([
      this.adapter.getAll('threads') as Promise<ThreadRecord[]>,
      this.adapter.getAll('turns') as Promise<TurnRecord[]>,
      this.adapter.getAll('providerResponses') as Promise<ProviderResponseRecord[]>,
      this.adapter.getAll('canvasBlocks') as Promise<CanvasBlockRecord[]>,
      this.adapter.getAll('sessions') as Promise<SessionRecord[]>,
      this.adapter.getAll('documents') as Promise<DocumentRecord[]>
    ]);

    // Find threads without valid sessions
    for (const thread of allThreads) {
      const session = allSessions.find(s => s.id === thread.sessionId);
      if (!session) {
        orphans.push({
          id: thread.id,
          type: 'thread',
          reason: `References non-existent session ${thread.sessionId}`
        });
      }
    }

    // Find turns without valid threads
    for (const turn of allTurns) {
      const thread = allThreads.find(t => t.id === turn.threadId);
      if (!thread) {
        orphans.push({
          id: turn.id,
          type: 'turn',
          reason: `References non-existent thread ${turn.threadId}`
        });
      }
    }

    // Find provider responses without valid turns
    for (const response of allResponses) {
      const turn = allTurns.find(t => t.id === response.aiTurnId);
      if (!turn) {
        orphans.push({
          id: response.id,
          type: 'providerResponse',
          reason: `References non-existent turn ${response.aiTurnId}`
        });
      }
    }

    // Find canvas blocks without valid documents
    for (const block of allBlocks) {
      const document = allDocuments.find(d => d.id === block.documentId);
      if (!document) {
        orphans.push({
          id: block.id,
          type: 'canvasBlock',
          reason: `References non-existent document ${block.documentId}`
        });
      }
    }

    return orphans;
  }

  /**
   * Get entity statistics and relationships summary
   */
  async getEntityStats(): Promise<Record<string, any>> {
    const [
      allSessions,
      allThreads,
      allTurns,
      allResponses,
      allDocuments,
      allBlocks,
      allGhosts,
      allContexts,
      allMetadata
    ] = await Promise.all([
      this.adapter.getAll('sessions') as Promise<SessionRecord[]>,
      this.adapter.getAll('threads') as Promise<ThreadRecord[]>,
      this.adapter.getAll('turns') as Promise<TurnRecord[]>,
      this.adapter.getAll('providerResponses') as Promise<ProviderResponseRecord[]>,
      this.adapter.getAll('documents') as Promise<DocumentRecord[]>,
      this.adapter.getAll('canvasBlocks') as Promise<CanvasBlockRecord[]>,
      this.adapter.getAll('ghosts') as Promise<GhostRecord[]>,
      this.adapter.getAll('providerContexts') as Promise<ProviderContextRecord[]>,
      this.adapter.getAll('metadata') as Promise<MetadataRecord[]>
    ]);

    const sessionCount = allSessions.length;
    const threadCount = allThreads.length;
    const turnCount = allTurns.length;
    const responseCount = allResponses.length;
    const documentCount = allDocuments.length;
    const blockCount = allBlocks.length;
    const ghostCount = allGhosts.length;
    const contextCount = allContexts.length;
    const metadataCount = allMetadata.length;

    return {
      entities: {
        sessions: sessionCount,
        threads: threadCount,
        turns: turnCount,
        providerResponses: responseCount,
        documents: documentCount,
        canvasBlocks: blockCount,
        ghosts: ghostCount,
        providerContexts: contextCount,
        metadata: metadataCount,
        total: sessionCount + threadCount + turnCount + responseCount + 
               documentCount + blockCount + ghostCount + contextCount + metadataCount
      },
      relationships: {
        avgThreadsPerSession: threadCount / Math.max(sessionCount, 1),
        avgTurnsPerThread: turnCount / Math.max(threadCount, 1),
        avgResponsesPerTurn: responseCount / Math.max(turnCount, 1),
        avgBlocksPerDocument: blockCount / Math.max(documentCount, 1),
        avgMetadataPerEntity: metadataCount / Math.max(sessionCount + threadCount + turnCount + responseCount + documentCount + blockCount, 1)
      }
    };
  }

  // Private helper methods

  private async getEntityById(id: string, type: string): Promise<any> {
    return await this.adapter.get(type + 's' as any, id);
  }

  private async buildSessionProvenance(trace: ProvenanceTrace, session: SessionRecord): Promise<void> {
    // Children: threads, documents, contexts
    const [allThreads, allDocuments, allContexts] = await Promise.all([
      this.adapter.getAll('threads') as Promise<ThreadRecord[]>,
      this.adapter.getAll('documents') as Promise<DocumentRecord[]>,
      this.adapter.getAll('providerContexts') as Promise<ProviderContextRecord[]>
    ]);

    const threads = allThreads.filter(thread => thread.sessionId === session.id);
    const documents = allDocuments.filter(doc => doc.sessionId === session.id || doc.sourceSessionId === session.id);
    const contexts = allContexts.filter(context => context.sessionId === session.id);

    threads.forEach(thread => {
      trace.children.push({
        id: thread.id,
        type: 'thread',
        relationship: 'contains',
        data: thread
      });
    });

    documents.forEach(doc => {
      trace.children.push({
        id: doc.id,
        type: 'document',
        relationship: 'contains',
        data: doc
      });
    });

    contexts.forEach(context => {
      trace.children.push({
        id: context.id,
        type: 'providerContext',
        relationship: 'uses',
        data: context
      });
    });
  }

  private async buildThreadProvenance(trace: ProvenanceTrace, thread: ThreadRecord): Promise<void> {
    // Parent: session
    const session = await this.adapter.get('sessions', thread.sessionId) as SessionRecord;
    if (session) {
      trace.parents.push({
        id: session.id,
        type: 'session',
        relationship: 'belongsTo',
        data: session
      });
    }

    // Children: turns
    const allTurns = await this.adapter.getAll('turns') as TurnRecord[];
    const turns = allTurns.filter(turn => turn.threadId === thread.id);
    turns.forEach(turn => {
      trace.children.push({
        id: turn.id,
        type: 'turn',
        relationship: 'contains',
        data: turn
      });
    });
  }

  private async buildTurnProvenance(trace: ProvenanceTrace, turn: TurnRecord): Promise<void> {
    // Parent: thread
    const thread = await this.adapter.get('threads', turn.threadId) as ThreadRecord;
    if (thread) {
      trace.parents.push({
        id: thread.id,
        type: 'thread',
        relationship: 'belongsTo',
        data: thread
      });

      // Grandparent: session
      const session = await this.adapter.get('sessions', thread.sessionId) as SessionRecord;
      if (session) {
        trace.parents.push({
          id: session.id,
          type: 'session',
          relationship: 'belongsTo',
          data: session
        });
      }
    }

    // Children: provider responses
    const allResponses = await this.adapter.getAll('providerResponses') as ProviderResponseRecord[];
    const responses = allResponses.filter(response => response.aiTurnId === turn.id);
    responses.forEach(response => {
      trace.children.push({
        id: response.id,
        type: 'providerResponse',
        relationship: 'generates',
        data: response
      });
    });
  }

  private async buildDocumentProvenance(trace: ProvenanceTrace, document: DocumentRecord): Promise<void> {
    // Parent: session
    const sessionId = document.sessionId || document.sourceSessionId;
    if (sessionId) {
      const session = await this.adapter.get('sessions', sessionId) as SessionRecord;
      if (session) {
        trace.parents.push({
          id: session.id,
          type: 'session',
          relationship: 'belongsTo',
          data: session
        });
      }
    }

    // Children: canvas blocks
    const allBlocks = await this.adapter.getAll('canvasBlocks') as CanvasBlockRecord[];
    const blocks = allBlocks.filter(block => block.documentId === document.id);
    blocks.forEach(block => {
      trace.children.push({
        id: block.id,
        type: 'canvasBlock',
        relationship: 'contains',
        data: block
      });
    });
  }

  private async buildCanvasBlockProvenance(trace: ProvenanceTrace, block: CanvasBlockRecord): Promise<void> {
    // Parent: document
    const document = await this.adapter.get('documents', block.documentId) as DocumentRecord;
    if (document) {
      trace.parents.push({
        id: document.id,
        type: 'document',
        relationship: 'belongsTo',
        data: document
      });

      // Grandparent: session
      const sessionId = document.sessionId || document.sourceSessionId;
      if (sessionId) {
        const session = await this.adapter.get('sessions', sessionId) as SessionRecord;
        if (session) {
          trace.parents.push({
            id: session.id,
            type: 'session',
            relationship: 'belongsTo',
            data: session
          });
        }
      }
    }

    // Parent block (if hierarchical)
    if (block.parentId) {
      const parentBlock = await this.adapter.get('canvasBlocks', block.parentId) as CanvasBlockRecord;
      if (parentBlock) {
        trace.parents.push({
          id: parentBlock.id,
          type: 'canvasBlock',
          relationship: 'childOf',
          data: parentBlock
        });
      }
    }

    // Child blocks
    const allBlocks = await this.adapter.getAll('canvasBlocks') as CanvasBlockRecord[];
    const childBlocks = allBlocks.filter(child => child.parentId === block.id);
    childBlocks.forEach(child => {
      trace.children.push({
        id: child.id,
        type: 'canvasBlock',
        relationship: 'contains',
        data: child
      });
    });
  }

  private async buildGenericProvenance(trace: ProvenanceTrace, entityId: string, entityType: string): Promise<void> {
    // Find metadata for this entity
    const allMetadata = await this.adapter.getAll('metadata') as MetadataRecord[];
    const metadata = allMetadata.filter(meta => meta.entityId === entityId);
    metadata.forEach(meta => {
      trace.related.push({
        id: meta.id,
        type: 'metadata',
        relationship: 'hasMetadata',
        data: meta
      });
    });
  }
}