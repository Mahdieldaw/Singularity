// ui/state/atoms.ts - ATOMIC STATE ARCHITECTURE
import { atom } from 'jotai';
import { atomWithImmer } from 'jotai-immer';
import { atomWithStorage } from 'jotai/utils';

import type {
  TurnMessage,
  UserTurn,
  AiTurn,
  UiPhase,
  AppStep,
  HistorySessionSummary,
  ComposerState,
  DocumentRecord,
  CanvasTabData,
  ProviderResponse
} from '../types';
import { ViewMode } from '../types';
import { LLM_PROVIDERS_CONFIG } from '../constants';

// =============================================================================
// ATOMIC STATE PRIMITIVES (The Foundation)
// =============================================================================

/**
 * CORE DATA LAYER: Map-based turn storage
 * 
 * Pattern: "Normalized State Store"
 * Why: O(1) lookups, surgical updates, structural sharing via Immer
 * 
 * CRITICAL: This is the single source of truth for all turn data.
 * All reads/writes must go through this Map to maintain consistency.
 */
export const turnsMapAtom = atomWithImmer<Map<string, TurnMessage>>(new Map());

/**
 * STRUCTURAL INDEX: Ordered list of turn IDs
 * 
 * Pattern: "Primary Key Index"
 * Why: Provides stable reference for Virtuoso (only changes on add/remove)
 * 
 * CRITICAL: This array should NEVER change during streaming, only when
 * a new turn is added or an old turn is deleted.
 */
export const turnIdsAtom = atomWithImmer<string[]>([]);

/**
 * BACKWARD COMPATIBILITY: Derived messages array
 * 
 * Pattern: "Materialized View"
 * Why: Allows old code to keep working while we migrate to atomic patterns
 * 
 * NOTE: This is a read-only derived atom. Do NOT use setMessages anymore.
 * Use setTurnsMap + setTurnIds instead.
 */
export const messagesAtom = atom<TurnMessage[]>((get) => {
  const ids = get(turnIdsAtom);
  const map = get(turnsMapAtom);
  return ids.map(id => map.get(id)).filter((t): t is TurnMessage => !!t);
});

/**
 * SURGICAL SELECTOR: Provider responses for a specific turn
 * 
 * Pattern: "Parameterized Selector Function"
 * Why: Enables isolated subscriptions - only components displaying this
 * specific turn's responses will re-render when they change.
 * 
 * CRITICAL: This is the key to breaking the re-render cascade. Components
 * subscribe to this selector instead of the entire turnsMapAtom.
 */
export const providerResponsesForTurnAtom = atom(
  (get) => (turnId: string): Record<string, ProviderResponse> => {
    const turn = get(turnsMapAtom).get(turnId);
    if (!turn || turn.type !== 'ai') return {};
    
    const aiTurn = turn as AiTurn;
    
    // Combine all response sources
    return {
      ...(aiTurn.batchResponses || {}),
      ...(aiTurn.hiddenBatchOutputs || {})
    };
  }
);

/**
 * TURN ACCESSOR: Get a single turn by ID
 * 
 * Pattern: "Entity Selector"
 * Why: Components can subscribe to a single turn's data without
 * triggering re-renders when other turns change.
 */
export const turnByIdAtom = atom(
  (get) => (turnId: string): TurnMessage | undefined => {
    return get(turnsMapAtom).get(turnId);
  }
);

// =============================================================================
// SESSION & CHAT STATE
// =============================================================================

export const currentSessionIdAtom = atomWithStorage<string | null>('htos_last_session_id', null);
export const pendingUserTurnsAtom = atomWithImmer<Map<string, UserTurn>>(new Map());

// =============================================================================
// UI PHASE & LOADING STATE
// =============================================================================

export const isLoadingAtom = atom<boolean>(false);
export const uiPhaseAtom = atom<UiPhase>('idle');
export const activeAiTurnIdAtom = atom<string | null>(null);
export const currentAppStepAtom = atom<AppStep>('initial');
export const isContinuationModeAtom = atom<boolean>(false);

// =============================================================================
// UI VISIBILITY & VIEW MODE
// =============================================================================

export const viewModeAtom = atom<ViewMode>(ViewMode.CHAT);
export const isHistoryPanelOpenAtom = atom<boolean>(false);
export const isSettingsOpenAtom = atom<boolean>(false);
export const showWelcomeAtom = atom((get) => get(turnIdsAtom).length === 0);
export const expandedUserTurnsAtom = atomWithImmer<Record<string, boolean>>({});
export const showSourceOutputsAtom = atom<boolean>(false);
export const showScrollToBottomAtom = atom<boolean>(false);

// =============================================================================
// MODEL & FEATURE CONFIGURATION (PERSISTED)
// =============================================================================

export const selectedModelsAtom = atomWithStorage<Record<string, boolean>>(
  'htos_selected_models',
  {}
);
export const mappingEnabledAtom = atomWithStorage<boolean>('htos_mapping_enabled', true);
export const mappingProviderAtom = atomWithStorage<string | null>('htos_mapping_provider', null);
export const synthesisProviderAtom = atomWithStorage<string | null>('htos_synthesis_provider', null);
export const synthesisProvidersAtom = atomWithStorage<string[]>('htos_synthesis_providers', []);
export const powerUserModeAtom = atomWithStorage<boolean>('htos_power_user_mode', false);
export const thinkOnChatGPTAtom = atomWithStorage<boolean>('htos_think_chatgpt', false);
export const isVisibleModeAtom = atomWithStorage<boolean>('htos_visible_mode', true);
export const isReducedMotionAtom = atomWithStorage<boolean>('htos_reduced_motion', false);

// Provider Contexts (metadata like rate limits, model names)
export const providerContextsAtom = atomWithImmer<Record<string, any>>({});

// =============================================================================
// ROUND-LEVEL SELECTIONS (CLIPS)
// =============================================================================

export const synthSelectionsByRoundAtom = atomWithImmer<Record<string, Record<string, boolean>>>({});
export const mappingSelectionByRoundAtom = atomWithImmer<Record<string, string | null>>({});
export const thinkSynthByRoundAtom = atomWithImmer<Record<string, boolean>>({});
export const thinkMappingByRoundAtom = atomWithImmer<Record<string, boolean>>({});
export const activeClipsAtom = atom<Record<string, { synthesis?: string; mapping?: string }>>({});

// =============================================================================
// HISTORY & SESSIONS
// =============================================================================

export const historySessionsAtom = atomWithImmer<HistorySessionSummary[]>([]);
export const isHistoryLoadingAtom = atom<boolean>(false);

// =============================================================================
// COMPOSER MODE STATE
// =============================================================================

export const composerStateAtom = atom<ComposerState | null>(null);
export const currentDocumentAtom = atomWithImmer<DocumentRecord | null>(null);
export const canvasTabsAtom = atomWithImmer<CanvasTabData[]>([]);
export const activeCanvasIdAtom = atom<string | null>(null);
export const isComposerDirtyAtom = atom<boolean>(false);
export const documentsRefreshTickAtom = atom<number>(0);

// =============================================================================
// CONNECTION & SYSTEM STATE
// =============================================================================

export const connectionStatusAtom = atom<{ isConnected: boolean; isReconnecting: boolean }>({
  isConnected: false,
  isReconnecting: true
});
export const alertTextAtom = atom<string | null>(null);
export const chatInputHeightAtom = atom<number>(80);

// =============================================================================
// DERIVED ATOMS (COMPUTED STATE)
// =============================================================================

export const activeProviderCountAtom = atom((get) => {
  const selected = get(selectedModelsAtom) || {};
  return Object.values(selected).filter(Boolean).length;
});

export const isFirstTurnAtom = atom((get) => {
  const ids = get(turnIdsAtom);
  const map = get(turnsMapAtom);
  return !ids.some(id => {
    const turn = map.get(id);
    return turn?.type === 'user';
  });
});
