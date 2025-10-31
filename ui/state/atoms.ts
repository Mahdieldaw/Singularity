import { atom } from 'jotai';
import { atomWithImmer } from 'jotai-immer';
import { atomWithStorage } from 'jotai/utils';

// Import UI types and constants
import type {
  TurnMessage,
  UserTurn,
  UiPhase,
  AppStep,
  HistorySessionSummary,
  ComposerState,
  DocumentRecord,
  CanvasTabData
} from '../types';
import { ViewMode } from '../types';
import { LLM_PROVIDERS_CONFIG } from '../constants';

// Build a sensible default selected models map (matches original App defaults)
const DEFAULT_SELECTED_MODELS: Record<string, boolean> = LLM_PROVIDERS_CONFIG.reduce<Record<string, boolean>>((acc, p) => {
  acc[p.id] = ['claude', 'gemini', 'chatgpt'].includes(p.id);
  return acc;
}, {} as Record<string, boolean>);

// -----------------------------
// Core chat state
// -----------------------------
export const messagesAtom = atomWithImmer<TurnMessage[]>([]);
export const currentSessionIdAtom = atomWithStorage<string | null>('htos_last_session_id', null);
export const pendingUserTurnsAtom = atomWithImmer<Map<string, UserTurn>>(new Map());

// -----------------------------
// UI phase & loading
// -----------------------------
export const isLoadingAtom = atom<boolean>(false);
export const uiPhaseAtom = atom<UiPhase>('idle');
export const activeAiTurnIdAtom = atom<string | null>(null);
export const currentAppStepAtom = atom<AppStep>('initial');
export const isContinuationModeAtom = atom<boolean>(false);

// -----------------------------
// UI visibility
// -----------------------------
export const viewModeAtom = atom<ViewMode>(ViewMode.CHAT);
export const isHistoryPanelOpenAtom = atom<boolean>(false);
export const isSettingsOpenAtom = atom<boolean>(false);
export const showWelcomeAtom = atom((get: any) => get(messagesAtom).length === 0);
export const expandedUserTurnsAtom = atomWithImmer<Record<string, boolean>>({});
export const showSourceOutputsAtom = atom<boolean>(false);
export const showScrollToBottomAtom = atom<boolean>(false);

// -----------------------------
// Model & feature configuration (persisted)
// -----------------------------
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

// Provider Contexts
export const providerContextsAtom = atomWithImmer<Record<string, any>>({});

// -----------------------------
// Round-level selections
// -----------------------------
export const synthSelectionsByRoundAtom = atomWithImmer<Record<string, Record<string, boolean>>>({});
export const mappingSelectionByRoundAtom = atomWithImmer<Record<string, string | null>>({});
export const thinkSynthByRoundAtom = atomWithImmer<Record<string, boolean>>({});
export const thinkMappingByRoundAtom = atomWithImmer<Record<string, boolean>>({});
export const activeClipsAtom = atomWithImmer<Record<string, { synthesis?: string; mapping?: string }>>({});

// -----------------------------
// History & sessions
// -----------------------------
export const historySessionsAtom = atomWithImmer<HistorySessionSummary[]>([]);
export const isHistoryLoadingAtom = atom<boolean>(false);
// -----------------------------
// Composer mode state
// -----------------------------
export const composerStateAtom = atom<ComposerState | null>(null);

// New: Composer atoms used by useComposer
export const currentDocumentAtom = atomWithImmer<DocumentRecord | null>(null);
export const canvasTabsAtom = atomWithImmer<CanvasTabData[]>([]);
export const activeCanvasIdAtom = atom<string | null>(null);
export const isComposerDirtyAtom = atom<boolean>(false);
export const documentsRefreshTickAtom = atom<number>(0);


// -----------------------------
// Connection & system state
// -----------------------------
export const connectionStatusAtom = atom<{ isConnected: boolean; isReconnecting: boolean }>({ isConnected: false, isReconnecting: true });
export const alertTextAtom = atom<string | null>(null);
export const chatInputHeightAtom = atom<number>(80);

// -----------------------------
// Derived atoms (examples)
// -----------------------------
export const activeProviderCountAtom = atom((get: any) => {
  const selected = get(selectedModelsAtom) || {};
  return Object.values(selected).filter(Boolean).length;
});

export const isFirstTurnAtom = atom((get: any) => {
  const messages = get(messagesAtom) as TurnMessage[];
  return !messages.some((m: any) => m.type === 'user');
});
