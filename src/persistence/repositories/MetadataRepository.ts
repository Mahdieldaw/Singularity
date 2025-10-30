// // Metadata Repository - Manages metadata records

import { BaseRepository } from '../BaseRepository';
import { MetadataRecord } from '../types';

export class MetadataRepository extends BaseRepository<MetadataRecord> {
  constructor(db: IDBDatabase) {
    super(db, 'metadata');
  }

  /**
   * Get metadata by entity ID
   */
  async getByEntityId(entityId: string): Promise<MetadataRecord[]> {
    const all = await this.getAll();
    return all.filter(m => m.entityId === entityId);
  }

  /**
   * Get metadata by entity type
   */
  async getByEntityType(entityType: string): Promise<MetadataRecord[]> {
    const all = await this.getAll();
    return all.filter(m => m.entityType === entityType);
  }

  /**
   * Get metadata by key
   */
  async getByKey(key: string): Promise<MetadataRecord[]> {
    const all = await this.getAll();
    return all.filter(m => m.key === key);
  }

  /**
   * Get metadata by session ID
   */
  async getBySessionId(sessionId: string): Promise<MetadataRecord[]> {
    const all = await this.getAll();
    return all.filter(m => m.sessionId === sessionId);
  }

  /**
   * Get metadata created within a date range
   */
  async getByDateRange(startDate: Date, endDate: Date): Promise<MetadataRecord[]> {
    const start = startDate.getTime();
    const end = endDate.getTime();
    const all = await this.getAll();
    return all.filter(m => m.createdAt >= start && m.createdAt <= end);
  }

  /**
   * Get specific metadata value by entity and key
   */
  async getValue(entityId: string, key: string): Promise<any | null> {
    const entityMetadata = await this.getByEntityId(entityId);
    const metadata = entityMetadata.find((m: MetadataRecord) => m.key === key);
    return metadata ? metadata.value : null;
  }

  /**
   * Set metadata value for an entity
   */
  async setValue(
    entityId: string,
    entityType: string,
    sessionId: string,
    key: string,
    value: any
  ): Promise<MetadataRecord> {
    // Check if metadata already exists
    const existing = await this.getByEntityId(entityId);
    const existingMetadata = existing.find(m => m.key === key);

    if (existingMetadata) {
      // Update existing metadata
      existingMetadata.value = value;
      existingMetadata.updatedAt = Date.now();
      await this.put(existingMetadata);
      return existingMetadata;
    } else {
      // Create new metadata
      const metadata: MetadataRecord = {
        id: crypto.randomUUID(),
        entityId,
        entityType,
        sessionId,
        key,
        value,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      await this.add(metadata);
      return metadata;
    }
  }

  /**
   * Get all metadata for an entity as key-value pairs
   */
  async getEntityMetadata(entityId: string): Promise<Record<string, any>> {
    const metadata = await this.getByEntityId(entityId);
    const result: Record<string, any> = {};
    
    metadata.forEach(m => {
      result[m.key] = m.value;
    });
    
    return result;
  }

  /**
   * Set multiple metadata values for an entity
   */
  async setEntityMetadata(
    entityId: string,
    entityType: string,
    sessionId: string,
    keyValues: Record<string, any>
  ): Promise<MetadataRecord[]> {
    const results: MetadataRecord[] = [];
    
    for (const [key, value] of Object.entries(keyValues)) {
      const metadata = await this.setValue(entityId, entityType, sessionId, key, value);
      results.push(metadata);
    }
    
    return results;
  }

  /**
   * Delete metadata by entity and key
   */
  async deleteByEntityAndKey(entityId: string, key: string): Promise<void> {
    const entityMetadata = await this.getByEntityId(entityId);
    const metadata = entityMetadata.find(m => m.key === key);
    
    if (metadata) {
      await this.delete(metadata.id);
    }
  }

  /**
   * Delete all metadata for an entity
   */
  async deleteEntityMetadata(entityId: string): Promise<number> {
    const metadata = await this.getByEntityId(entityId);
    
    if (metadata.length > 0) {
      const ids = metadata.map(m => m.id);
      await this.deleteMany(ids);
    }
    
    return metadata.length;
  }

  /**
   * Search metadata by value
   */
  async searchByValue(searchValue: any, entityType?: string): Promise<MetadataRecord[]> {
    let metadata: MetadataRecord[];
    
    if (entityType) {
      metadata = await this.getByEntityType(entityType);
    } else {
      metadata = await this.getAll();
    }

    return metadata.filter(m => {
      if (typeof searchValue === 'string' && typeof m.value === 'string') {
        return m.value.toLowerCase().includes(searchValue.toLowerCase());
      }
      return JSON.stringify(m.value) === JSON.stringify(searchValue);
    });
  }

  /**
   * Get metadata statistics by entity type
   */
  async getStatsByEntityType(): Promise<Record<string, {
    totalRecords: number;
    uniqueEntities: number;
    uniqueKeys: number;
    keyFrequency: Record<string, number>;
  }>> {
    const allMetadata = await this.getAll();
    const stats: Record<string, any> = {};

    allMetadata.forEach(metadata => {
      // Skip records with undefined entityType to avoid index errors
      if (!metadata.entityType) return;
      
      if (!stats[metadata.entityType]) {
        stats[metadata.entityType] = {
          totalRecords: 0,
          uniqueEntities: new Set(),
          uniqueKeys: new Set(),
          keyFrequency: {}
        };
      }

      const entityStats = stats[metadata.entityType];
      if (entityStats) {
          entityStats.totalRecords++;
          if (metadata.entityId) {
            entityStats.uniqueEntities.add(metadata.entityId);
          }
          entityStats.uniqueKeys.add(metadata.key);
          entityStats.keyFrequency[metadata.key] = (entityStats.keyFrequency[metadata.key] || 0) + 1;
        }
    });

    // Convert Sets to counts
    Object.keys(stats).forEach(entityType => {
      stats[entityType].uniqueEntities = stats[entityType].uniqueEntities.size;
      stats[entityType].uniqueKeys = stats[entityType].uniqueKeys.size;
    });

    return stats;
  }

  /**
   * Get entities that have a specific metadata key
   */
  async getEntitiesWithKey(key: string, entityType?: string): Promise<string[]> {
    let metadata: MetadataRecord[];
    
    if (entityType) {
      const typeMetadata = await this.getByEntityType(entityType);
      metadata = typeMetadata.filter(m => m.key === key);
    } else {
      metadata = await this.getByKey(key);
    }

    const entityIds = new Set(metadata.map(m => m.entityId).filter((id): id is string => id !== undefined));
    return Array.from(entityIds);
  }

  /**
   * Get entities with specific metadata value
   */
  async getEntitiesWithValue(key: string, value: any, entityType?: string): Promise<string[]> {
    let metadata: MetadataRecord[];
    
    if (entityType) {
      const typeMetadata = await this.getByEntityType(entityType);
      metadata = typeMetadata.filter(m => m.key === key);
    } else {
      metadata = await this.getByKey(key);
    }

    const matchingMetadata = metadata.filter(m => 
      JSON.stringify(m.value) === JSON.stringify(value)
    );

    return matchingMetadata.map(m => m.entityId).filter((id): id is string => id !== undefined);
  }

  /**
   * Get metadata key usage statistics
   */
  async getKeyUsageStats(): Promise<{
    totalKeys: number;
    keyFrequency: Record<string, number>;
    mostUsedKeys: Array<{ key: string; count: number }>;
    leastUsedKeys: Array<{ key: string; count: number }>;
  }> {
    const allMetadata = await this.getAll();
    const keyFrequency: Record<string, number> = {};

    allMetadata.forEach(metadata => {
      keyFrequency[metadata.key] = (keyFrequency[metadata.key] || 0) + 1;
    });

    const sortedKeys = Object.entries(keyFrequency)
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);

    return {
      totalKeys: Object.keys(keyFrequency).length,
      keyFrequency,
      mostUsedKeys: sortedKeys.slice(0, 10),
      leastUsedKeys: sortedKeys.slice(-10).reverse()
    };
  }

  /**
   * Get metadata for multiple entities
   */
  async getMultipleEntityMetadata(entityIds: string[]): Promise<Record<string, Record<string, any>>> {
    const result: Record<string, Record<string, any>> = {};
    
    for (const entityId of entityIds) {
      result[entityId] = await this.getEntityMetadata(entityId);
    }
    
    return result;
  }

  /**
   * Update metadata value
   */
  async updateValue(entityId: string, key: string, value: any): Promise<void> {
    const entityMetadata = await this.getByEntityId(entityId);
    const metadata = entityMetadata.find(m => m.key === key);
    
    if (metadata) {
      metadata.value = value;
      metadata.updatedAt = Date.now();
      await this.put(metadata);
    }
  }

  /**
   * Increment numeric metadata value
   */
  async incrementValue(entityId: string, key: string, increment: number = 1): Promise<number> {
    const currentValue = await this.getValue(entityId, key);
    const newValue = (typeof currentValue === 'number' ? currentValue : 0) + increment;
    
    const entityMetadata = await this.getByEntityId(entityId);
    const metadata = entityMetadata.find(m => m.key === key);
    
    if (metadata) {
      metadata.value = newValue;
      metadata.updatedAt = Date.now();
      await this.put(metadata);
    }
    
    return newValue;
  }

  /**
   * Get metadata history for an entity (if versioning is implemented)
   */
  async getEntityMetadataHistory(entityId: string): Promise<MetadataRecord[]> {
    const metadata = await this.getByEntityId(entityId);
    return metadata.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Clean up orphaned metadata (entities that no longer exist)
   */
  async cleanupOrphanedMetadata(validEntityIds: Set<string>): Promise<number> {
    const allMetadata = await this.getAll();
    const orphaned = allMetadata.filter(m => m.entityId && !validEntityIds.has(m.entityId));
    
    if (orphaned.length > 0) {
      const ids = orphaned.map(m => m.id);
      await this.deleteMany(ids);
    }
    
    return orphaned.length;
  }

  /**
   * Get metadata size statistics
   */
  async getSizeStats(): Promise<{
    totalRecords: number;
    totalSize: number;
    averageSize: number;
    largestRecord: { id: string; size: number } | null;
    sizeDistribution: {
      small: number;    // < 100 bytes
      medium: number;   // 100 - 1KB
      large: number;    // 1KB - 10KB
      xlarge: number;   // > 10KB
    };
  }> {
    const allMetadata = await this.getAll();
    const sizes = allMetadata.map(m => ({
      id: m.id,
      size: JSON.stringify(m.value).length
    }));

    const totalSize = sizes.reduce((sum, { size }) => sum + size, 0);
    const largestRecord = sizes.length > 0 
      ? sizes.reduce((max, current) => current.size > max.size ? current : max)
      : null;

    return {
      totalRecords: allMetadata.length,
      totalSize,
      averageSize: allMetadata.length > 0 ? totalSize / allMetadata.length : 0,
      largestRecord,
      sizeDistribution: {
        small: sizes.filter(s => s.size < 100).length,
        medium: sizes.filter(s => s.size >= 100 && s.size < 1024).length,
        large: sizes.filter(s => s.size >= 1024 && s.size < 10240).length,
        xlarge: sizes.filter(s => s.size >= 10240).length
      }
    };
  }

  /**
   * Bulk set metadata for multiple entities
   */
  async bulkSetMetadata(
    entities: Array<{
      entityId: string;
      entityType: string;
      sessionId: string;
      metadata: Record<string, any>;
    }>
  ): Promise<MetadataRecord[]> {
    const results: MetadataRecord[] = [];
    
    for (const entity of entities) {
      const entityResults = await this.setEntityMetadata(
        entity.entityId,
        entity.entityType,
        entity.sessionId,
        entity.metadata
      );
      results.push(...entityResults);
    }
    
    return results;
  }
}