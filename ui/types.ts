// src/ui/types.ts

/**
 * UI-LAYER TYPES ,/bn
 * 
 * This file serves as the single source of truth for all UI type definitions.
 * It imports types from the shared contract and persistence layers, then re-exports
 * them along with UI-specific types to create a unified type system.
 */

import type { Descendant } from 'slate';

// Import types from shared contract (runtime types)
import type { 
  ProviderKey,
  ProviderResponse as ContractProviderResponse,
  AiTurn as ContractAiTurn,
  PortMessage
} from '../shared/contract';

// Import types from persistence layer (schema types)
import type { 
  DocumentRecord as SchemaDocumentRecord,
  CanvasBlockRecord,
  GhostRecord,
  SessionRecord,
  ThreadRecord,
  TurnRecord,
  UserTurnRecord,
  AiTurnRecord,
  ProviderResponseRecord
} from '../src/persistence/types';
// UI typing for canvas tabs
import type { JSONContent } from '@tiptap/react';

// UI typing for canvas tabs
export interface CanvasTabData {
  id: string;
  title: string;
  content: JSONContent;
  createdAt: number;
  updatedAt: number;
}

// =============================================================================
// RE-EXPORTED TYPES FROM SHARED CONTRACT
// =============================================================================

// Core provider and workflow types
export type { ProviderKey, PortMessage } from '../shared/contract';

// Provider response type (unified from contract)
export type ProviderResponse = ContractProviderResponse;
export type ProviderResponseStatus = ProviderResponse['status'];

// =============================================================================
// RE-EXPORTED TYPES FROM PERSISTENCE LAYER
// =============================================================================

// Re-export persistence types for UI use
export type { 
  SessionRecord,
  ThreadRecord,
  TurnRecord,
  UserTurnRecord,
  AiTurnRecord,
  ProviderResponseRecord,
  CanvasBlockRecord,
  GhostRecord
} from '../src/persistence/types';

// =============================================================================
// UI-SPECIFIC TYPES
// =============================================================================

/** The current high-level step of the UI, controlling what major controls are shown. */
export type AppStep = 'initial' | 'awaitingSynthesis' | 'synthesis' | 'synthesisDone';

/** The UI's finite state for core user interactions. */
export type UiPhase = 'idle' | 'streaming' | 'awaiting_action';

/** Defines the primary view mode of the application. */
export enum ViewMode {
  CHAT = 'chat',
  COMPOSER = 'composer',
  HISTORY = 'history'
}

/** Defines the properties for rendering a supported LLM provider in the UI. */
export interface LLMProvider {
  id: ProviderKey | string;
  name: string;
  hostnames: string[];
  color: string;
  logoBgClass: string;
  icon?: any;
  emoji?: string;
}

// =============================================================================
// UNIFIED TURN TYPES (UI-ADAPTED FROM CONTRACT)
// =============================================================================

/** Represents a turn initiated by the user (UI-adapted). */
export interface UserTurn {
  type: 'user';
  id: string;
  text: string;
  createdAt: number;
  sessionId: string | null;
}

/** 
 * Represents a turn from the AI, containing all provider responses (UI-adapted).
 * This extends the contract AiTurn with UI-specific properties.
 */
export interface AiTurn extends Omit<ContractAiTurn, 'type'> {
  type: 'ai';
  // Add UI-specific properties
  composerState?: ComposerState;
  hiddenBatchOutputs?: Record<string, ProviderResponse>;
  
  // DEPRECATED BUT KEPT FOR TRANSITION:
  /** @deprecated Use `batchResponses`, `synthesisResponses`, or `mappingResponses` instead. */
  providerResponses?: Record<string, ProviderResponse>;
  isSynthesisAnswer?: boolean;
  isMappingAnswer?: boolean;
  isHidden?: boolean;
}

/** The union type for any message in the chat timeline. This is the main type for the `messages` state array. */
export type TurnMessage = UserTurn | AiTurn;

/** Type guard to check if a turn is a UserTurn. */
export const isUserTurn = (turn: TurnMessage): turn is UserTurn => turn.type === 'user';

/** Type guard to check if a turn is an AiTurn. */
export const isAiTurn = (turn: TurnMessage): turn is AiTurn => turn.type === 'ai';

// =============================================================================
// HISTORY & SESSION LOADING
// =============================================================================

/** Represents a session summary object used for display in the history panel. */
export interface HistorySessionSummary {
  id: string;
  sessionId: string;
  startTime: number;
  lastActivity: number;
  title: string;
  firstMessage?: string;
  messageCount: number;
  messages?: TurnMessage[];
}

/** ALIAS: This keeps `App.tsx` working without needing to find/replace `ChatSession` everywhere yet. */
export type ChatSession = HistorySessionSummary;

/** The shape of the API response when fetching the list of chat sessions. */
export interface HistoryApiResponse {
  sessions: HistorySessionSummary[];
}

/** 
 * The shape of the API response when fetching a full session to load into the UI.
 */
export interface FullSessionPayload {
  id: string;
  sessionId: string;
  title: string;
  createdAt: number;
  lastActivity: number;
  turns: TurnMessage[];
  providerContexts: Record<string, any>;
}

/** ALIAS: This keeps `App.tsx` working without needing to find/replace `BackendFullSession` yet. */
export type BackendFullSession = FullSessionPayload;

/** DEPRECATED: Old message format from legacy port communication. Replaced by contract.ts types. */
/** @deprecated Replaced by the PortMessage types in `shared/contract.ts` */
export interface BackendMessage {
  type: string;
  sessionId: string;
  [key: string]: any;
}

// =============================================================================
// COMPOSER MODE TYPE DEFINITIONS
// =============================================================================

export type SlateDescendant = Descendant;

// Unified Provenance type (combining UI and persistence layer concepts)
export interface Provenance {
  sessionId: string;
  aiTurnId: string;
  providerId: string;
  responseType: 'batch' | 'synthesis' | 'mapping' | 'hidden';
  responseIndex: number;
  textRange?: [number, number];
}

// Unified DocumentRecord that extends persistence schema but uses Slate types
export interface DocumentRecord extends Omit<SchemaDocumentRecord, 'canvasContent' | 'canvasTabs'> {
  canvasContent: SlateDescendant[];
  canvasTabs?: CanvasTabData[];
  activeTabId?: string;
  // Add temporary storage flag for enhanced document store
  _tempStorage?: boolean;
}

export interface ContentSourceMap {
  [nodeId: string]: {
    providerId: string;
    sourceType: 'batch' | 'synthesis' | 'mapping' | 'hidden';
    originalIndex: number;
    granularity: 'full' | 'paragraph' | 'sentence';
    text: string;
    timestamp: number;
    metadata?: Record<string, any>;
  };
}

export interface RefinementEntry {
  id: string;
  timestamp: number;
  inputContent: string;
  refinedContent: string;
  refinementType: 'grammar' | 'style' | 'tone' | 'structure' | 'custom';
  model: string;
  status: 'pending' | 'completed' | 'error';
  userRating?: number;
  appliedChanges: boolean;
  error?: string;
}

export interface ExportEntry {
  id: string;
  timestamp: number;
  format: 'markdown' | 'html' | 'text' | 'json';
  content: string;
  metadata?: Record<string, any>;
}

// Unified Ghost type (UI-adapted from persistence layer)
export interface Ghost {
  id: string;
  text: string;
  preview: string;
  provenance: Provenance;
  order: number;
  createdAt: number;
  isPinned: boolean;
}

export interface ComposerState {
  canvasContent: SlateDescendant[];
  granularity: 'full' | 'paragraph' | 'sentence';
  sourceMap: ContentSourceMap;
  isDirty: boolean;
  createdAt: number;
  lastModified: number;
  lastSaved?: number;
  refinementHistory: RefinementEntry[];
  exportHistory: ExportEntry[];
  ghosts: Ghost[];
  documentId?: string;
  // Add content property for compatibility
  content: SlateDescendant[];
}

export interface GranularUnit {
  id: string;
  text: string;
  type: 'full' | 'paragraph' | 'sentence';
  sourceId: string;
  providerId: string;
  index: number;
}

export interface ComposableSource {
  id: string;
  type: 'batch' | 'synthesis' | 'mapping' | 'hidden';
  providerId: string;
  content: string;
  status: ProviderResponseStatus;
  metadata?: Record<string, any>;
}

export interface ComposerContextValue {
  activeAiTurn: AiTurn | null;
  canvasContent: SlateDescendant[];
  granularityLevel: 'full' | 'paragraph' | 'sentence';
  selectedSources: ComposableSource[];
  updateCanvas: (content: SlateDescendant[]) => void;
  persistComposerState: () => void;
  setGranularity: (level: 'full' | 'paragraph' | 'sentence') => void;
}