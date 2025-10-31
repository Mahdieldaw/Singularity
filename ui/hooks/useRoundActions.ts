// ui/hooks/useRoundActions.ts - FIXED VERSION
import { useCallback, useRef } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { 
  messagesAtom, 
  synthSelectionsByRoundAtom, 
  mappingSelectionByRoundAtom, 
  activeClipsAtom, 
  currentSessionIdAtom, 
  isLoadingAtom, 
  uiPhaseAtom, 
  currentAppStepAtom, 
  activeAiTurnIdAtom,
  thinkSynthByRoundAtom, 
  thinkMappingByRoundAtom 
} from '../state/atoms';
import api from '../services/extension-api';
import type { ProviderKey } from '../../shared/contract';
import type { TurnMessage, UserTurn, AiTurn, ProviderResponse } from '../types';

export function useRoundActions() {
  const [messages, setMessages] = useAtom(messagesAtom);
  const [synthSelectionsByRound, setSynthSelectionsByRound] = useAtom(synthSelectionsByRoundAtom);
  const [mappingSelectionByRound, setMappingSelectionByRound] = useAtom(mappingSelectionByRoundAtom);
  const [activeClips] = useAtom(activeClipsAtom);
  const [currentSessionId] = useAtom(currentSessionIdAtom);
  const setIsLoading = useSetAtom(isLoadingAtom);
  const setUiPhase = useSetAtom(uiPhaseAtom);
  const setCurrentAppStep = useSetAtom(currentAppStepAtom);
  const setActiveAiTurnId = useSetAtom(activeAiTurnIdAtom);
  const [thinkSynthByRound] = useAtom(thinkSynthByRoundAtom);
  const [thinkMappingByRound] = useAtom(thinkMappingByRoundAtom);

  const isSynthRunningRef = useRef(false);

  const findRoundForUserTurn = useCallback((userTurnId: string) => {
    const userIndex = messages.findIndex((m: TurnMessage) => m.id === userTurnId && m.type === 'user');
    if (userIndex === -1) return null;
    
    let aiIndex = -1;
    for (let i = userIndex + 1; i < messages.length; i++) {
      const t = messages[i];
      if (t.type === 'user') break;
      if (t.type === 'ai') {
        const ai = t as AiTurn;
        if (!ai.isSynthesisAnswer && !ai.isMappingAnswer) {
          aiIndex = i;
          break;
        }
      }
    }
    
    const ai = aiIndex !== -1 ? (messages[aiIndex] as AiTurn) : undefined;
    return { 
      userIndex, 
      user: messages[userIndex], 
      aiIndex, 
      ai 
    };
  }, [messages]);

  const runSynthesisForRound = useCallback(async (userTurnId: string, providerIdOverride?: string) => {
    if (!currentSessionId || isSynthRunningRef.current) return;

    const roundInfo = findRoundForUserTurn(userTurnId);
    if (!roundInfo || !roundInfo.user || !roundInfo.ai) return;

    const { ai } = roundInfo;

    // FIXED: Use the same eligibility logic as useEligibility
    const outputsFromBatch = Object.values(ai.batchResponses || {}).filter(
      (r: any) => r.status === 'completed' && r.text?.trim()
    );

    // Also check if we have any completed synthesis or mapping responses
    const hasCompletedSynthesis = ai?.synthesisResponses 
      ? Object.values(ai.synthesisResponses).some(resp => {
          const responses = Array.isArray(resp) ? resp : [resp];
          return responses.some(r => r.status === 'completed' && r.text?.trim());
        })
      : false;

    const hasCompletedMapping = ai?.mappingResponses 
      ? Object.values(ai.mappingResponses).some(resp => {
          const responses = Array.isArray(resp) ? resp : [resp];
          return responses.some(r => r.status === 'completed' && r.text?.trim());
        })
      : false;

    // Same eligibility logic as useEligibility
    const enoughOutputs = outputsFromBatch.length >= 2 || hasCompletedSynthesis || hasCompletedMapping;
    if (!enoughOutputs) {
      console.warn(`Not enough outputs for synthesis in round ${userTurnId}`);
      return;
    }

    // Determine which providers to synthesize
    const selected = providerIdOverride
      ? [providerIdOverride]
      : Object.entries(synthSelectionsByRound[userTurnId] || {})
          .filter(([_, on]) => on)
          .map(([pid]) => pid);
    if (selected.length === 0) return;

    const isHistoricalRerun = !!providerIdOverride;

    // Get preferred mapping provider for historical context
    const clipPreferredMapping = activeClips[ai.id]?.mapping || null;
    const perRoundMapping = mappingSelectionByRound[userTurnId] || null;
    const preferredMappingCandidate = clipPreferredMapping || perRoundMapping;
    const preferredMappingProvider = preferredMappingCandidate || null;

    // Add optimistic pending synthesis responses to the AI turn
    setMessages((draft: TurnMessage[]) => {
      const aiTurn = draft.find(t => t.id === ai.id && t.type === 'ai') as AiTurn | undefined;
      if (!aiTurn) return;

      // ✅ Initialize if missing
      if (!aiTurn.synthesisResponses) aiTurn.synthesisResponses = {};
      const prev = aiTurn.synthesisResponses;
      const next: Record<string, ProviderResponse[]> = { ...prev };
      
      selected.forEach((pid) => {
        const arr = Array.isArray(next[pid]) ? next[pid] : [];
        arr.push({ 
          providerId: pid as ProviderKey, 
          text: '', 
          status: 'pending', 
          createdAt: Date.now() 
        });
        next[pid] = arr;
      });
      
      aiTurn.synthesisResponses = next;
    });

    // Set active turn for streaming
    setActiveAiTurnId(ai.id);
    isSynthRunningRef.current = true;
    setIsLoading(true);
    setUiPhase('streaming');
    setCurrentAppStep('synthesis');

    try {
      const fallbackMapping = (() => { 
        try { return localStorage.getItem('htos_mapping_provider'); } 
        catch { return null; } 
      })();
      const effectiveMappingProvider = perRoundMapping || fallbackMapping || null;

      const historicalContext: any = { 
        userTurnId, 
        sourceType: 'batch' 
      };
      if (isHistoricalRerun && preferredMappingProvider) {
        historicalContext.preferredMappingProvider = preferredMappingProvider as ProviderKey;
      }

      const request: any = {
        sessionId: currentSessionId,
        threadId: 'default-thread',
        mode: 'continuation',
        userMessage: (roundInfo.user as UserTurn).text || '',
        providers: [],
        synthesis: { 
          enabled: true, 
          providers: selected as ProviderKey[] 
        },
        mapping: (!isHistoricalRerun && effectiveMappingProvider) 
          ? { enabled: true, providers: [effectiveMappingProvider as ProviderKey] } 
          : undefined,
        useThinking: !!(thinkSynthByRound[userTurnId]),
        historicalContext
      };

      // Save last synthesis model to localStorage
      if (selected.length === 1) {
        try { 
          localStorage.setItem('htos_last_synthesis_model', selected[0]); 
        } catch {}
      }

      await api.executeWorkflow(request);
    } catch (err) {
      console.error('Synthesis run failed:', err);
      setIsLoading(false);
      setUiPhase('awaiting_action');
      setActiveAiTurnId(null);
    } finally {
      isSynthRunningRef.current = false;
    }
  }, [
    currentSessionId, 
    synthSelectionsByRound, 
    findRoundForUserTurn, 
    thinkSynthByRound, 
    mappingSelectionByRound, 
    activeClips, 
    setMessages,
    setActiveAiTurnId,
    setIsLoading, 
    setUiPhase, 
    setCurrentAppStep
  ]);

  const runMappingForRound = useCallback(async (userTurnId: string, providerIdOverride?: string) => {
    if (!currentSessionId) return;

    const roundInfo = findRoundForUserTurn(userTurnId);
    if (!roundInfo?.user || !roundInfo.ai) return;

    const userTurn = roundInfo.user as UserTurn;
    const { ai } = roundInfo;
    
    // FIXED: Use the same eligibility logic as useEligibility
    const outputsFromBatch = Object.values(ai.batchResponses || {}).filter(
      (r: any) => r.status === 'completed' && r.text?.trim()
    );

    // Also check if we have any completed synthesis or mapping responses
    const hasCompletedSynthesis = ai?.synthesisResponses 
      ? Object.values(ai.synthesisResponses).some(resp => {
          const responses = Array.isArray(resp) ? resp : [resp];
          return responses.some(r => r.status === 'completed' && r.text?.trim());
        })
      : false;

    const hasCompletedMapping = ai?.mappingResponses 
      ? Object.values(ai.mappingResponses).some(resp => {
          const responses = Array.isArray(resp) ? resp : [resp];
          return responses.some(r => r.status === 'completed' && r.text?.trim());
        })
      : false;

    // Same eligibility logic as useEligibility
    const enoughOutputs = outputsFromBatch.length >= 2 || hasCompletedSynthesis || hasCompletedMapping;
    if (!enoughOutputs) {
      console.warn(`Not enough outputs for mapping in round ${userTurnId}`);
      return;
    }

    const effectiveMappingProvider = providerIdOverride || mappingSelectionByRound[userTurnId];
    if (!effectiveMappingProvider) return;

    // Update mapping selection
    setMappingSelectionByRound((draft: Record<string, string | null>) => {
      if (draft[userTurnId] === effectiveMappingProvider) return;
      draft[userTurnId] = effectiveMappingProvider;
    });

    // Add optimistic pending mapping response to the AI turn
    setMessages((draft: TurnMessage[]) => {
      const aiTurn = draft.find(t => t.id === ai.id && t.type === 'ai') as AiTurn | undefined;
      if (!aiTurn) return;

      const prev = aiTurn.mappingResponses || {};
      const next: Record<string, ProviderResponse[]> = { ...prev };
      const arr = Array.isArray(next[effectiveMappingProvider]) 
        ? [...next[effectiveMappingProvider]] 
        : [];
      
      arr.push({
        providerId: effectiveMappingProvider as ProviderKey,
        text: '',
        status: 'pending',
        createdAt: Date.now(),
      });
      next[effectiveMappingProvider] = arr;
      aiTurn.mappingResponses = next;
    });

    // Set active turn for streaming
    setActiveAiTurnId(ai.id);
    setIsLoading(true);
    setUiPhase('streaming');
    setCurrentAppStep('synthesis');

    try {
      const request: any = {
        sessionId: currentSessionId,
        threadId: 'default-thread',
        mode: 'continuation',
        userMessage: userTurn.text || '',
        providers: [],
        mapping: { 
          enabled: true, 
          providers: [effectiveMappingProvider as ProviderKey] 
        },
        useThinking: effectiveMappingProvider === 'chatgpt' 
          ? !!thinkMappingByRound[userTurnId] 
          : false,
        historicalContext: { 
          userTurnId, 
          sourceType: 'batch' 
        }
      };

      await api.executeWorkflow(request);
    } catch (err) {
      console.error('Mapping run failed:', err);
      setIsLoading(false);
      setUiPhase('awaiting_action');
      setActiveAiTurnId(null);
    }
  }, [
    currentSessionId, 
    findRoundForUserTurn, 
    mappingSelectionByRound, 
    setMappingSelectionByRound,
    thinkMappingByRound,
    setMessages,
    setActiveAiTurnId,
    setIsLoading, 
    setUiPhase, 
    setCurrentAppStep
  ]);

  const toggleSynthForRound = useCallback((userTurnId: string, providerId: string) => {
    setSynthSelectionsByRound((draft: Record<string, Record<string, boolean>>) => {
      const current = draft[userTurnId] || {};
      draft[userTurnId] = { ...current, [providerId]: !current[providerId] };
    });
  }, [setSynthSelectionsByRound]);

  const selectMappingForRound = useCallback((userTurnId: string, providerId: string) => {
    setMappingSelectionByRound((draft: Record<string, string | null>) => {
      draft[userTurnId] = draft[userTurnId] === providerId ? null : providerId;
    });
  }, [setMappingSelectionByRound]);

  return { 
    runSynthesisForRound, 
    runMappingForRound, 
    toggleSynthForRound, 
    selectMappingForRound 
  };
}