// Repository Index - Exports all repository classes

import { BaseRepository } from '../BaseRepository';
import { SessionsRepository } from './SessionsRepository';
import { ThreadsRepository } from './ThreadsRepository';
import { TurnsRepository } from './TurnsRepository';
import { ProviderResponsesRepository } from './ProviderResponsesRepository';
import { DocumentsRepository } from './DocumentsRepository';
import { CanvasBlocksRepository } from './CanvasBlocksRepository';
import { GhostsRepository } from './GhostsRepository';
import { ProviderContextsRepository } from './ProviderContextsRepository';
import { MetadataRepository } from './MetadataRepository';

export { BaseRepository } from '../BaseRepository';
export { SessionsRepository } from './SessionsRepository';
export { ThreadsRepository } from './ThreadsRepository';
export { TurnsRepository } from './TurnsRepository';
export { ProviderResponsesRepository } from './ProviderResponsesRepository';
export { DocumentsRepository } from './DocumentsRepository';
export { CanvasBlocksRepository } from './CanvasBlocksRepository';
export { GhostsRepository } from './GhostsRepository';
export { ProviderContextsRepository } from './ProviderContextsRepository';
export { MetadataRepository } from './MetadataRepository';

// Repository collection type for dependency injection
export interface RepositoryCollection {
  sessions: SessionsRepository;
  threads: ThreadsRepository;
  turns: TurnsRepository;
  providerResponses: ProviderResponsesRepository;
  documents: DocumentsRepository;
  canvasBlocks: CanvasBlocksRepository;
  ghosts: GhostsRepository;
  providerContexts: ProviderContextsRepository;
  metadata: MetadataRepository;
}

/**
 * Create all repositories from a database instance
 */
export function createRepositories(db: IDBDatabase): RepositoryCollection {
  return {
    sessions: new SessionsRepository(db),
    threads: new ThreadsRepository(db),
    turns: new TurnsRepository(db),
    providerResponses: new ProviderResponsesRepository(db),
    documents: new DocumentsRepository(db),
    canvasBlocks: new CanvasBlocksRepository(db),
    ghosts: new GhostsRepository(db),
    providerContexts: new ProviderContextsRepository(db),
    metadata: new MetadataRepository(db)
  };
}