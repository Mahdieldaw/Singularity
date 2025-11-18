// Type declarations for SessionManager.js

export interface SessionData {
  id: string;
  turns: any[];
  threads: Record<string, any>;
  providerContexts: Record<string, any>;
  metadata: {
    createdAt: number;
    updatedAt: number;
    activeThreadId: string;
  };
}

export interface TurnData {
  id: string;
  userTurn: any;
  aiTurn: any;
  threadId: string;
  timestamp: number;
}

export interface ThreadData {
  id: string;
  name: string | null;
  color: string;
  parentThreadId: string | null;
  branchPointTurnId: string | null;
  createdAt: number;
}

export interface ProviderContextOptions {
  [key: string]: any;
}

export interface PersistenceStatus {
  persistenceEnabled: boolean;
  isInitialized: boolean;
  adapterReady: boolean;
}

export declare class SessionManager {
  sessions: Record<string, SessionData>;
  storageKey: string;
  isExtensionContext: boolean;
  adapter: any;
  isInitialized: boolean;

  constructor();

  initialize(config?: { adapter?: any; initTimeoutMs?: number }): Promise<void>;

  getOrCreateSession(sessionId: string): Promise<SessionData>;

  saveSession(sessionId: string): Promise<void>;

  deleteSession(sessionId: string): Promise<boolean>;

  updateProviderContext(
    sessionId: string,
    providerId: string,
    result: any,
    options?: ProviderContextOptions,
  ): Promise<void>;
  updateProviderContextsBatch(
    sessionId: string,
    updates: Record<string, any>,
    options?: ProviderContextOptions,
  ): Promise<void>;

  getProviderContexts(sessionId: string, threadId?: string): any;

  getTurn(sessionId: string, turnId: string): any;
  getTurns(sessionId: string): any[];
  getPersistenceStatus(): PersistenceStatus;
}

export default SessionManager;
