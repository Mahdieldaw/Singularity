// Persistence Queries Index

export {
  ProvenanceQueries,
  type ProvenanceTrace,
  type SessionLineage,
  type CrossReference,
  type ActivityEntry
} from './ProvenanceQueries.js';

/**
 * Factory function to create provenance queries instance using the persistence adapter
 */
import type { IPersistenceAdapter } from '../adapters/IPersistenceAdapter.js';
import { ProvenanceQueries } from './ProvenanceQueries.js';

export function createProvenanceQueries(adapter: IPersistenceAdapter): ProvenanceQueries {
  return new ProvenanceQueries(adapter as any);
}