// ui/hooks/useChat.ts - MAP-BASED STATE MANAGEMENT
import { useCallback } from 'react';
import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import api from '../services/extension-api';
import { 
  turnsMapAtom,
  turnIdsAtom,
  currentSessionIdAtom, 
  pendingUserTurnsAtom, 
  isLoadingAtom, 
  selectedModelsAtom, 
  mappingEnabledAtom, 
  mappingProviderAtom, 
  synthesisProviderAtom, 
  synthesisProvidersAtom, 
  powerUserModeAtom, 
  thinkOnChatGPTAtom, 
  activeAiTurnIdAtom, 
  currentAppStepAtom, 
  uiPhaseAtom, 
  isContinuationModeAtom, 
  isHistoryPanelOpenAtom 
} from '../state/atoms';
import { createOptimisticAiTurn } from '../utils/turn-helpers';
import type { ExecuteWorkflowRequest, ProviderKey } from '../../shared/contract';
import { LLM_PROVIDERS_CONFIG } from '../constants';
import { computeThinkFlag } from '../../src/think/lib/think/computeThinkFlag.js';

import type { 
  HistorySessionSummary, 
  FullSessionPayload,
  TurnMessage,
  UserTurn,
  AiTurn,
  ProviderResponse
} from '../types';

/**
 * CRITICAL HOOK: Manages all chat state mutations
 * 
 * Pattern: "Command Layer" - encapsulates all write operations
 * to the atomic state layer.
 * 
 * KEY CHANGES FROM OLD VERSION:
 * - setMessages → setTurnsMap + setTurnIds
 * - All array mutations → Map.set() + array.push()
 * - Structural separation: IDs change only on add/remove
 */
export function useChat() {
  // Read atoms
  const selectedModels = useAtomValue(selectedModelsAtom);
  const mappingEnabled = useAtomValue(mappingEnabledAtom);
  const mappingProvider = useAtomValue(mappingProviderAtom);
  const synthesisProvider = useAtomValue(synthesisProviderAtom);
  const thinkOnChatGPT = useAtomValue(thinkOnChatGPTAtom);
  const currentSessionId = useAtomValue(currentSessionIdAtom);
  
  // Write atoms
  const setTurnsMap = useSetAtom(turnsMapAtom);
  const setTurnIds = useSetAtom(turnIdsAtom);
  const setCurrentSessionId = useSetAtom(currentSessionIdAtom);
  const [pendingUserTurns, setPendingUserTurns] = useAtom(pendingUserTurnsAtom);
  const setIsLoading = useSetAtom(isLoadingAtom);
  const setActiveAiTurnId = useSetAtom(activeAiTurnIdAtom);
  const setCurrentAppStep = useSetAtom(currentAppStepAtom);
  const setUiPhase = useSetAtom(uiPhaseAtom);
  const setIsContinuationMode = useSetAtom(isContinuationModeAtom);
  const setIsHistoryPanelOpen = useSetAtom(isHistoryPanelOpenAtom);

  /**
   * Send a new message or continuation
   * 
   * Pattern: "Optimistic Update" - we immediately add turns to the Map
   * and ID array, then the backend streams updates via port messages.
   */
  const sendMessage = useCallback(async (prompt: string, mode: 'new' | 'continuation') => {
    if (!prompt || !prompt.trim()) return;

    setIsLoading(true);
    setUiPhase('streaming');
    setCurrentAppStep('initial');

    const activeProviders = LLM_PROVIDERS_CONFIG
      .filter(p => selectedModels[p.id])
      .map(p => p.id as ProviderKey);
    
    if (activeProviders.length === 0) {
      setIsLoading(false);
      return;
    }

    const ts = Date.now();
    const userTurn: UserTurn = {
      type: 'user',
      id: `user-${ts}-${Math.random().toString(36).slice(2,8)}`,
      text: prompt,
      createdAt: ts,
      sessionId: currentSessionId || null
    };
    const aiTurnId = `ai-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

    // Track pending user turn
    setPendingUserTurns((draft: Map<string, UserTurn>) => {
      draft.set(aiTurnId, userTurn);
    });

    // ✅ NEW: Write to Map + IDs atomically
    setTurnsMap((draft: Map<string, TurnMessage>) => {
      draft.set(userTurn.id, userTurn);
    });
    setTurnIds((draft: string[]) => {
      draft.push(userTurn.id);
    });

    try {
      const shouldUseSynthesis = !!(synthesisProvider && activeProviders.length > 1);

      const fallbackMapping = (() => { 
        try { return localStorage.getItem('htos_mapping_provider'); } 
        catch { return null; } 
      })();
      const effectiveMappingProvider = mappingProvider || fallbackMapping || null;
      const shouldUseMapping = !!(
        mappingEnabled && 
        effectiveMappingProvider && 
        activeProviders.length > 1 && 
        activeProviders.includes(effectiveMappingProvider as ProviderKey)
      );

      const requestMode: 'new-conversation' | 'continuation' = 
        (mode === 'new' && (!currentSessionId || turnIdsAtom.init.length === 0)) 
          ? 'new-conversation' 
          : 'continuation';

      const request: ExecuteWorkflowRequest = {
        sessionId: (requestMode === 'new-conversation' ? null : currentSessionId) as any,
        threadId: 'default-thread',
        mode: requestMode,
        userMessage: prompt,
        providers: activeProviders,
        synthesis: shouldUseSynthesis 
          ? { enabled: true, providers: [synthesisProvider as ProviderKey] } 
          : undefined,
        mapping: shouldUseMapping 
          ? { enabled: true, providers: [effectiveMappingProvider as ProviderKey] } 
          : undefined,
        useThinking: computeThinkFlag({ modeThinkButtonOn: thinkOnChatGPT, input: prompt })
      };

      const aiTurn = createOptimisticAiTurn(
        aiTurnId,
        userTurn,
        activeProviders,
        shouldUseSynthesis,
        shouldUseMapping,
        synthesisProvider || undefined,
        effectiveMappingProvider || undefined
      );

      // ✅ NEW: Add AI turn to Map + IDs
      setTurnsMap((draft: Map<string, TurnMessage>) => {
        draft.set(aiTurn.id, aiTurn);
      });
      setTurnIds((draft: string[]) => {
        draft.push(aiTurn.id);
      });

      setActiveAiTurnId(aiTurn.id);
      await api.executeWorkflow(request);

      if (request.sessionId) {
        setCurrentSessionId(request.sessionId as string);
      }
    } catch (err) {
      console.error('Failed to execute workflow:', err);
      setIsLoading(false);
      setActiveAiTurnId(null);
      setPendingUserTurns((draft: Map<string, UserTurn>) => {
        draft.delete(aiTurnId);
      });
    }
  }, [
    selectedModels, 
    currentSessionId, 
    setTurnsMap,
    setTurnIds,
    setCurrentSessionId, 
    setIsLoading, 
    setActiveAiTurnId, 
    synthesisProvider, 
    mappingEnabled, 
    mappingProvider, 
    thinkOnChatGPT,
    setPendingUserTurns,
    setCurrentAppStep,
    setUiPhase
  ]);

  /**
   * Start a new chat (clear all state)
   */
  const newChat = useCallback(() => {
    setCurrentSessionId(null);
    setTurnsMap((draft: Map<string, TurnMessage>) => {
      draft.clear();
    });
    setTurnIds((draft: string[]) => {
      draft.length = 0;
    });
  }, [setTurnsMap, setTurnIds, setCurrentSessionId]);

  /**
   * Load a historical session
   * 
   * Pattern: "Bulk State Replacement"
   * CRITICAL: We replace the entire Map and ID array in one operation.
   */
  const selectChat = useCallback(async (session: HistorySessionSummary) => {
    const sessionId = session.sessionId || session.id;
    if (!sessionId) {
      console.error('[useChat] No sessionId in session object');
      return;
    }

    setCurrentSessionId(sessionId);
    setIsLoading(true);

    try {
      const response = await api.getHistorySession(sessionId);
      const fullSession = response as unknown as FullSessionPayload;

      if (!fullSession || !fullSession.turns) {
        console.warn('[useChat] Empty session loaded');
        setTurnsMap((draft: Map<string, TurnMessage>) => { draft.clear(); });
        setTurnIds((draft: string[]) => { draft.length = 0; });
        setIsLoading(false);
        return;
      }

      /**
       * ✅ CRITICAL: Transform backend "rounds" format
       * Backend sends: { userTurnId, aiTurnId, user: {...}, providers: {...}, synthesisResponses, mappingResponses }
       */
      const newIds: string[] = [];
      const newMap = new Map<string, TurnMessage>();
      
      fullSession.turns.forEach((round: any) => {
        // 1. Extract UserTurn
        if (round.user && round.user.text) {
          const userTurn: UserTurn = {
            type: 'user',
            id: round.userTurnId || round.user.id || `user-${round.createdAt}`,
            text: round.user.text,
            createdAt: round.user.createdAt || round.createdAt || Date.now(),
            sessionId: fullSession.sessionId
          };
          newIds.push(userTurn.id);
          newMap.set(userTurn.id, userTurn);
        }

        // 2. Extract AiTurn
        const providers = round.providers || {};
        const hasProviderData = Object.keys(providers).length > 0;
        
        if (hasProviderData) {
          // Transform providers object to batchResponses
          const batchResponses: Record<string, ProviderResponse> = {};
          Object.entries(providers).forEach(([providerId, data]: [string, any]) => {
            batchResponses[providerId] = {
              providerId: providerId as ProviderKey,
              text: data?.text || '',
              status: 'completed',
              createdAt: round.completedAt || round.createdAt || Date.now(),
              updatedAt: round.completedAt || round.createdAt || Date.now(),
              meta: data?.meta || {}
            };
          });

          // Normalize synthesis/mapping responses to arrays
          const normalizeSynthMap = (raw: any): Record<string, ProviderResponse[]> => {
            if (!raw) return {};
            const result: Record<string, ProviderResponse[]> = {};
            Object.entries(raw).forEach(([pid, val]: [string, any]) => {
              if (Array.isArray(val)) {
                result[pid] = val;
              } else {
                result[pid] = [val];
              }
            });
            return result;
          };

          const aiTurn: AiTurn = {
            type: 'ai',
            id: round.aiTurnId || `ai-${round.completedAt || Date.now()}`,
            userTurnId: round.userTurnId,
            sessionId: fullSession.sessionId,
            threadId: 'default-thread',
            createdAt: round.completedAt || round.createdAt || Date.now(),
            batchResponses,
            synthesisResponses: normalizeSynthMap(round.synthesisResponses),
            mappingResponses: normalizeSynthMap(round.mappingResponses)
          };
          
          newIds.push(aiTurn.id);
          newMap.set(aiTurn.id, aiTurn);
        }
      });

      console.log('[useChat] Loaded session with', newIds.length, 'turns');

      // ✅ NEW: Replace Map and IDs atomically
      setTurnsMap(newMap);
      setTurnIds(newIds);

      await api.ensurePort({ sessionId });

    } catch (error) {
      console.error('[useChat] Error loading session:', error);
      setTurnsMap((draft: Map<string, TurnMessage>) => { draft.clear(); });
      setTurnIds((draft: string[]) => { draft.length = 0; });
    } finally {
      setIsLoading(false);
      setIsHistoryPanelOpen(false);
    }
  }, [setTurnsMap, setTurnIds, setCurrentSessionId, setIsLoading, setIsHistoryPanelOpen]);

  /**
   * Delete a session
   */
  const deleteChat = useCallback(async (sessionId: string) => {
    try {
      await api.deleteBackgroundSession(sessionId);
    } catch (err) {
      console.error('Failed to delete session', err);
    }
  }, []);

  // For backward compatibility, provide a messages getter
  const turnsMap = useAtomValue(turnsMapAtom);
  const turnIds = useAtomValue(turnIdsAtom);
  const messages = turnIds.map(id => turnsMap.get(id)).filter((t): t is TurnMessage => !!t);

  return { sendMessage, newChat, selectChat, deleteChat, messages };
}
