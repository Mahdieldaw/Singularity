// Documents Repository - Manages document records

import { BaseRepository } from '../BaseRepository';
import { DocumentRecord } from '../types';

export class DocumentsRepository extends BaseRepository<DocumentRecord> {
  constructor(db: IDBDatabase) {
    super(db, 'documents');
  }

  /**
   * Get documents by session ID
   */
  async getBySessionId(sessionId: string): Promise<DocumentRecord[]> {
    const allDocuments = await this.getAll();
    return allDocuments.filter(doc => doc.sessionId === sessionId);
  }

  /**
   * Get documents by user ID
   */
  async getByUserId(userId: string): Promise<DocumentRecord[]> {
    return this.getByIndex('byUserId', userId);
  }

  /**
   * Get documents by type
   */
  async getByType(type: string): Promise<DocumentRecord[]> {
    return this.getByIndex('byType', type);
  }

  /**
   * Get documents created within a date range
   */
  async getByDateRange(startDate: Date, endDate: Date): Promise<DocumentRecord[]> {
    const range = IDBKeyRange.bound(startDate.getTime(), endDate.getTime());
    return this.getByIndex('byCreatedAt', range);
  }

  /**
   * Search documents by title
   */
  async searchByTitle(titleQuery: string): Promise<DocumentRecord[]> {
    const allDocuments = await this.getAll();
    const query = titleQuery.toLowerCase();
    
    return allDocuments.filter(doc => 
      doc.title.toLowerCase().includes(query)
    );
  }

  /**
   * Search documents by content
   */
  async searchByContent(contentQuery: string): Promise<DocumentRecord[]> {
    const allDocuments = await this.getAll();
    const query = contentQuery.toLowerCase();
    
    return allDocuments.filter(doc => 
      doc.content && doc.content.toLowerCase().includes(query)
    );
  }

  /**
   * Get recent documents for a user
   */
  async getRecentByUserId(userId: string, limit: number = 20): Promise<DocumentRecord[]> {
    const documents = await this.getByUserId(userId);
    return documents
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  /**
   * Get documents by session with pagination
   */
  async getBySessionIdPaginated(
    sessionId: string,
    offset: number = 0,
    limit: number = 20
  ): Promise<{ documents: DocumentRecord[]; hasMore: boolean }> {
    const sessionDocuments = await this.getBySessionId(sessionId);
    const documents = sessionDocuments.slice(offset, offset + limit);
    const hasMore = offset + limit < sessionDocuments.length;
    return {
      documents,
      hasMore
    };
  }

  /**
   * Update document content
   */
  async updateContent(documentId: string, content: string): Promise<void> {
    const document = await this.get(documentId);
    if (document) {
      document.content = content;
      document.updatedAt = Date.now();
      await this.put(document);
    }
  }

  /**
   * Update document title
   */
  async updateTitle(documentId: string, title: string): Promise<void> {
    const document = await this.get(documentId);
    if (document) {
      document.title = title;
      document.updatedAt = Date.now();
      await this.put(document);
    }
  }

  /**
   * Update document metadata
   */
  async updateMetadata(documentId: string, metadata: Record<string, any>): Promise<void> {
    const document = await this.get(documentId);
    if (document) {
      document.metadata = { ...document.metadata, ...metadata };
      document.updatedAt = Date.now();
      await this.put(document);
    }
  }

  /**
   * Get document statistics for a user
   */
  async getDocumentStats(userId: string): Promise<{
    total: number;
    byType: Record<string, number>;
    bySession: Record<string, number>;
    totalSize: number;
    averageSize: number;
  }> {
    const documents = await this.getByUserId(userId);
    
    const stats = {
      total: documents.length,
      byType: {} as Record<string, number>,
      bySession: {} as Record<string, number>,
      totalSize: 0,
      averageSize: 0
    };

    documents.forEach(doc => {
      if (doc.type) {
        stats.byType[doc.type] = (stats.byType[doc.type] || 0) + 1;
      }
      if (doc.sessionId) {
        stats.bySession[doc.sessionId] = (stats.bySession[doc.sessionId] || 0) + 1;
      }
      if (doc.content) {
        stats.totalSize += doc.content.length;
      }
    });

    stats.averageSize = documents.length > 0 ? stats.totalSize / documents.length : 0;

    return stats;
  }

  /**
   * Get documents by size range
   */
  async getByContentSize(minSize: number, maxSize?: number): Promise<DocumentRecord[]> {
    const allDocuments = await this.getAll();
    
    return allDocuments.filter(doc => {
      if (!doc.content) return false;
      const size = doc.content.length;
      return size >= minSize && (maxSize === undefined || size <= maxSize);
    });
  }

  /**
   * Get large documents (above threshold)
   */
  async getLargeDocuments(sizeThreshold: number = 10000): Promise<DocumentRecord[]> {
    return this.getByContentSize(sizeThreshold);
  }

  /**
   * Get documents by type for a session
   */
  async getBySessionAndType(sessionId: string, type: string): Promise<DocumentRecord[]> {
    const sessionDocuments = await this.getBySessionId(sessionId);
    return sessionDocuments.filter(doc => doc.type === type);
  }

  /**
   * Get document types for a user
   */
  async getDocumentTypes(userId: string): Promise<string[]> {
    const documents = await this.getByUserId(userId);
    const types = new Set(documents.map(doc => doc.type).filter(type => type !== undefined));
    return Array.from(types) as string[];
  }

  /**
   * Duplicate document
   */
  async duplicateDocument(
    documentId: string, 
    newTitle?: string,
    newSessionId?: string
  ): Promise<DocumentRecord> {
    const original = await this.get(documentId);
    if (!original) {
      throw new Error('Document not found');
    }

    const duplicate: DocumentRecord = {
      ...original,
      id: crypto.randomUUID(),
      title: newTitle || `${original.title} (Copy)`,
      sessionId: newSessionId || original.sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {
        ...original.metadata,
        duplicatedFrom: documentId,
        duplicatedAt: Date.now()
      }
    };

    await this.add(duplicate);
    return duplicate;
  }

  /**
   * Get document versions (documents with same base ID)
   */
  async getDocumentVersions(baseDocumentId: string): Promise<DocumentRecord[]> {
    const allDocuments = await this.getAll();
    
    return allDocuments.filter(doc => 
      doc.metadata?.duplicatedFrom === baseDocumentId || 
      doc.id === baseDocumentId
    ).sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Archive old documents
   */
  async archiveOldDocuments(olderThanDays: number = 180): Promise<number> {
    const cutoffDate = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    const allDocuments = await this.getAll();
    
    const toArchive = allDocuments.filter(doc => 
      doc.updatedAt < cutoffDate && !doc.metadata?.archived
    );

    const updates = toArchive.map(doc => ({
      ...doc,
      metadata: {
        ...doc.metadata,
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
   * Get archived documents
   */
  async getArchivedDocuments(userId?: string): Promise<DocumentRecord[]> {
    let documents: DocumentRecord[];
    
    if (userId) {
      documents = await this.getByUserId(userId);
    } else {
      documents = await this.getAll();
    }

    return documents.filter(doc => doc.metadata?.archived === true);
  }

  /**
   * Restore archived document
   */
  async restoreDocument(documentId: string): Promise<void> {
    const document = await this.get(documentId);
    if (document && document.metadata?.archived) {
      document.metadata = {
        ...document.metadata,
        archived: false,
        restoredAt: Date.now()
      };
      document.updatedAt = Date.now();
      await this.put(document);
    }
  }

  /**
   * Get document content summary
   */
  async getContentSummary(documentId: string, maxLength: number = 200): Promise<string> {
    const document = await this.get(documentId);
    if (!document || !document.content) {
      return '';
    }

    const content = document.content.trim();
    if (content.length <= maxLength) {
      return content;
    }

    return content.substring(0, maxLength) + '...';
  }

  /**
   * Bulk update document metadata
   */
  async bulkUpdateMetadata(
    documentIds: string[], 
    metadata: Record<string, any>
  ): Promise<number> {
    const documents = await this.getMany(documentIds);
    const updates = documents
      .filter(doc => doc !== null)
      .map(doc => ({
        ...doc!,
        metadata: { ...doc!.metadata, ...metadata },
        updatedAt: Date.now()
      }));

    if (updates.length > 0) {
      await this.putMany(updates);
    }

    return updates.length;
  }
}