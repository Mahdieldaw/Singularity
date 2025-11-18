// src/ui/types.ts

/**
 * UI-LAYER TYPES
 *
 * This file serves as the single source of truth for all UI type definitions.
 * It imports types from the shared contract and persistence layers, then re-exports
 * them along with UI-specific types to create a unified type system.
 */

// Import types from shared contract (runtime types)
import type {
  ProviderKey,
  ProviderResponse as ContractProviderResponse,
  AiTurn as ContractAiTurn,
  PortMessage,
} from "../shared/contract";
import {
  isUserTurn as isUserTurnContract,
  isAiTurn as isAiTurnContract,
} from "../shared/contract";

// Import types from persistence layer (schema types)
import type {
  SessionRecord,
  ThreadRecord,
  TurnRecord,
  UserTurnRecord,
  AiTurnRecord,
  ProviderResponseRecord,
} from "../src/persistence/types";

// =============================================================================
// RE-EXPORTED TYPES FROM SHARED CONTRACT
// =============================================================================

export type { ProviderKey, PortMessage } from "../shared/contract";

// Provider response type (unified from contract)
export type ProviderResponse = ContractProviderResponse;
export type ProviderResponseStatus = ProviderResponse["status"];

// =============================================================================
// RE-EXPORTED TYPES FROM PERSISTENCE LAYER
// =============================================================================

export type {
  SessionRecord,
  ThreadRecord,
  TurnRecord,
  UserTurnRecord,
  AiTurnRecord,
  ProviderResponseRecord,
} from "../src/persistence/types";

// =============================================================================
// UI-SPECIFIC TYPES
// =============================================================================

/** The current high-level step of the UI, controlling what major controls are shown. */
export type AppStep =
  | "initial"
  | "awaitingSynthesis"
  | "synthesis"
  | "synthesisDone";

/** The UI's finite state for core user interactions. */
export type UiPhase = "idle" | "streaming" | "awaiting_action";

/** Defines the primary view mode of the application. */

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

/** Represents a turn initiated by the user. */
export interface UserTurn {
  type: "user";
  id: string;
  text: string;
  createdAt: number;
  sessionId: string | null;
}

/**
 * Represents a turn from the AI, containing all provider responses.
 * This extends the contract AiTurn with UI-specific properties.
 */
export interface AiTurn extends Omit<ContractAiTurn, "type"> {
  type: "ai";
  hiddenBatchOutputs?: Record<string, ProviderResponse>;
}

/** The union type for any message in the chat timeline. This is the main type for the `messages` state array. */
export type TurnMessage = UserTurn | AiTurn;

/** Type guard to check if a turn is a UserTurn. */
export const isUserTurn = (turn: TurnMessage): turn is UserTurn =>
  isUserTurnContract(turn as any);

/** Type guard to check if a turn is an AiTurn. */
export const isAiTurn = (turn: TurnMessage): turn is AiTurn =>
  isAiTurnContract(turn as any);

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

/** The shape of the API response when fetching the list of chat sessions. */
export interface HistoryApiResponse {
  sessions: HistorySessionSummary[];
}

/** The shape of the API response when fetching a full session to load into the UI. */
export interface FullSessionPayload {
  id: string;
  sessionId: string;
  title: string;
  createdAt: number;
  lastActivity: number;
  turns: TurnMessage[];
  providerContexts: Record<string, any>;
}
