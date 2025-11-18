import { atom } from "jotai";
import { atomWithImmer } from "jotai-immer";
import { atomWithStorage, atomFamily } from "jotai/utils";

// Import UI types and constants
import type {
  TurnMessage,
  UserTurn,
  AiTurn,
  ProviderResponse,
  UiPhase,
  AppStep,
  HistorySessionSummary,
} from "../types";

// =============================================================================
// ATOMIC STATE PRIMITIVES (Map + ID index)
// =============================================================================
/**
 * Map-based turn storage for O(1) lookups and surgical updates.
 * This is the single source of truth for all turn data.
 */
export const turnsMapAtom = atomWithImmer<Map<string, TurnMessage>>(new Map());

/**
 * Ordered list of turn IDs. Changes only when turns are added/removed.
 */
export const turnIdsAtom = atomWithImmer<string[]>([]);

/**
 * Backward-compat: derived messages view from Map + IDs. Read-only.
 */
export const messagesAtom = atom<TurnMessage[]>((get) => {
  const ids = get(turnIdsAtom);
  const map = get(turnsMapAtom);
  return ids.map((id) => map.get(id)).filter((t): t is TurnMessage => !!t);
});

/**
 * Selector: provider responses for a specific AI turn (isolated subscription).
 */
export const providerResponsesForTurnAtom = atom(
  (get) =>
    (turnId: string): Record<string, ProviderResponse> => {
      const turn = get(turnsMapAtom).get(turnId);
      if (!turn || turn.type !== "ai") return {};
      const aiTurn = turn as AiTurn;
      return {
        ...(aiTurn.batchResponses || {}),
        ...(aiTurn.hiddenBatchOutputs || {}),
      };
    },
);

/**
 * Selector: get a single turn by ID (entity accessor).
 */
export const turnByIdAtom = atom(
  (get) =>
    (turnId: string): TurnMessage | undefined =>
      get(turnsMapAtom).get(turnId),
);

// -----------------------------
// Core chat state
// -----------------------------
export const currentSessionIdAtom = atomWithStorage<string | null>(
  "htos_last_session_id",
  null,
);
// Deprecated legacy pending user turns removed; TURN_CREATED event handles optimistic UI

// -----------------------------
// UI phase & loading
// -----------------------------
export const isLoadingAtom = atom<boolean>(false);
export const uiPhaseAtom = atom<UiPhase>("idle");
export const activeAiTurnIdAtom = atom<string | null>(null);
export const currentAppStepAtom = atom<AppStep>("initial");
// Derived: continuation mode is true whenever there is an active session and at least one turn
export const isContinuationModeAtom = atom((get) => {
  const sessionId = get(currentSessionIdAtom);
  const turnIds = get(turnIdsAtom);
  return sessionId !== null && turnIds.length > 0;
});

// -----------------------------
// UI visibility
// -----------------------------
export const isHistoryPanelOpenAtom = atom<boolean>(false);
export const isSettingsOpenAtom = atom<boolean>(false);
export const showWelcomeAtom = atom((get) => get(turnIdsAtom).length === 0);
export const turnExpandedStateFamily = atomFamily(
  (turnId: string) => atom(false),
  (a, b) => a === b,
);
export const showSourceOutputsFamily = atomFamily(
  (turnId: string) => atom(false),
  (a, b) => a === b,
);
export const showScrollToBottomAtom = atom<boolean>(false);

// -----------------------------
// Model & feature configuration (persisted)
// -----------------------------
export const selectedModelsAtom = atomWithStorage<Record<string, boolean>>(
  "htos_selected_models",
  {},
);
export const mappingEnabledAtom = atomWithStorage<boolean>(
  "htos_mapping_enabled",
  true,
);
export const mappingProviderAtom = atomWithStorage<string | null>(
  "htos_mapping_provider",
  null,
);
export const synthesisProviderAtom = atomWithStorage<string | null>(
  "htos_synthesis_provider",
  null,
);
export const synthesisProvidersAtom = atomWithStorage<string[]>(
  "htos_synthesis_providers",
  [],
);
export const powerUserModeAtom = atomWithStorage<boolean>(
  "htos_power_user_mode",
  false,
);
export const thinkOnChatGPTAtom = atomWithStorage<boolean>(
  "htos_think_chatgpt",
  false,
);
export const isVisibleModeAtom = atomWithStorage<boolean>(
  "htos_visible_mode",
  true,
);
export const isReducedMotionAtom = atomWithStorage<boolean>(
  "htos_reduced_motion",
  false,
);

// Provider Contexts
export const providerContextsAtom = atomWithImmer<Record<string, any>>({});

// -----------------------------
// Precise recompute targeting
// -----------------------------
export const activeRecomputeStateAtom = atom<{
  aiTurnId: string;
  stepType: "synthesis" | "mapping";
  providerId: string;
} | null>(null);

// -----------------------------
// Round-level selections
// -----------------------------
export const synthSelectionsByRoundAtom = atomWithImmer<
  Record<string, Record<string, boolean>>
>({});
export const mappingSelectionByRoundAtom = atomWithImmer<
  Record<string, string | null>
>({});
export const thinkSynthByRoundAtom = atomWithImmer<Record<string, boolean>>({});
export const thinkMappingByRoundAtom = atomWithImmer<Record<string, boolean>>(
  {},
);
export const activeClipsAtom = atom<
  Record<string, { synthesis?: string; mapping?: string }>
>({});

// -----------------------------
// History & sessions
// -----------------------------
export const historySessionsAtom = atomWithImmer<HistorySessionSummary[]>([]);
export const isHistoryLoadingAtom = atom<boolean>(false);
// -----------------------------
// Connection & system state
// -----------------------------
export const connectionStatusAtom = atom<{
  isConnected: boolean;
  isReconnecting: boolean;
}>({ isConnected: false, isReconnecting: true });
export const alertTextAtom = atom<string | null>(null);
export const chatInputHeightAtom = atom<number>(80);
// Track last meaningful workflow activity to allow UI watchdogs
export const lastActivityAtAtom = atom<number>(0);

// -----------------------------
// Derived atoms (examples)
// -----------------------------
export const activeProviderCountAtom = atom((get) => {
  const selected = get(selectedModelsAtom) || {};
  return Object.values(selected).filter(Boolean).length;
});

export const isFirstTurnAtom = atom((get) => {
  const ids = get(turnIdsAtom);
  const map = get(turnsMapAtom);
  return !ids.some((id) => map.get(id)?.type === "user");
});

// -----------------------------
// Prompt Refiner State
// -----------------------------
export const refinerDataAtom = atom<{
  refinedPrompt: string;
  explanation: string;
} | null>(null);
export const isRefinerOpenAtom = atom<boolean>(false);
export const isRefiningAtom = atom<boolean>(false);
export const refineModelAtom = atomWithStorage<string>(
  "htos_refine_model",
  "auto",
);
export const chatInputValueAtom = atomWithStorage<string>(
  "htos_chat_input_value",
  "",
);
