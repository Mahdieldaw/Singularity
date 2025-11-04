// ui/hooks/useRoundActions.ts - ID-BASED VERSION (avoids full UI rerender)
import { useCallback, useRef } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';

import {
  turnsMapAtom,
  turnIdsAtom,
  synthSelectionsByRoundAtom,
  mappingSelectionByRoundAtom,
  activeClipsAtom,
  currentSessionIdAtom,
  isLoadingAtom,
  uiPhaseAtom,
  currentAppStepAtom,
  activeAiTurnIdAtom,
  thinkSynthByRoundAtom,
  thinkMappingByRoundAtom,
  activeRecomputeStateAtom,
} from '../state/atoms';
import api from '../services/extension-api';
import { PRIMARY_STREAMING_PROVIDER_IDS } from '../constants';
import type { ProviderKey, PrimitiveWorkflowRequest } from '../../shared/contract';
import type { TurnMessage, UserTurn, AiTurn, ProviderResponse } from '../types';

export function useRoundActions() {
  const turnsMap = useAtomValue(turnsMapAtom);
  const turnIds = useAtomValue(turnIdsAtom);
  const setTurnsMap = useSetAtom(turnsMapAtom);

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
  const setActiveRecomputeState = useSetAtom(activeRecomputeStateAtom);

  const isSynthRunningRef = useRef(false);

  // Find primary AI turn attached to a userTurnId using id-indexed map
  const findRoundForUserTurn = useCallback(
    (userTurnId: string): { user?: UserTurn; ai?: AiTurn } | null => {
      const user = turnsMap.get(userTurnId) as UserTurn | undefined;
      if (!user || user.type !== 'user') return null;
      // Prefer direct lookup by scanning map for ai.userTurnId match, but keep order via turnIds
      for (const id of turnIds) {
        const t = turnsMap.get(id);
        if (t && t.type === 'ai' && (t as AiTurn).userTurnId === userTurnId) {
          return { user, ai: t as AiTurn };
        }
      }
      return { user, ai: undefined as any };
    },
    [turnsMap, turnIds]
  );

  const runSynthesisForRound = useCallback(
    async (userTurnId: string, providerIdOverride?: string) => {
      if (!currentSessionId || isSynthRunningRef.current) return;

      const roundInfo = findRoundForUserTurn(userTurnId);
      if (!roundInfo || !roundInfo.user || !roundInfo.ai) return;

      const { ai, user } = roundInfo;

      const outputsFromBatch = Object.values(ai.batchResponses || {}).filter(
        (r: any) => r.status === 'completed' && r.text?.trim()
      );

      const hasCompletedSynthesis = ai?.synthesisResponses
        ? Object.values(ai.synthesisResponses).some((resp) => {
            const responses = Array.isArray(resp) ? resp : [resp];
            return responses.some((r) => r.status === 'completed' && r.text?.trim());
          })
        : false;

      const hasCompletedMapping = ai?.mappingResponses
        ? Object.values(ai.mappingResponses).some((resp) => {
            const responses = Array.isArray(resp) ? resp : [resp];
            return responses.some((r) => r.status === 'completed' && r.text?.trim());
          })
        : false;

      const enoughOutputs = outputsFromBatch.length >= 2 || hasCompletedSynthesis || hasCompletedMapping;
      if (!enoughOutputs) {
        console.warn(`Not enough outputs for synthesis in round ${userTurnId}`);
        return;
      }

      const selected = providerIdOverride
        ? [providerIdOverride]
        : Object.entries(synthSelectionsByRound[userTurnId] || {})
            .filter(([_, on]) => on)
            .map(([pid]) => pid);
      if (selected.length === 0) return;

      const isHistoricalRerun = !!providerIdOverride;

      const clipPreferredMapping = activeClips[ai.id]?.mapping || null;
      const perRoundMapping = mappingSelectionByRound[userTurnId] || null;
      const preferredMappingCandidate = clipPreferredMapping || perRoundMapping;
      const preferredMappingProvider = preferredMappingCandidate || null;

      setTurnsMap((draft: Map<string, TurnMessage>) => {
        const existing = draft.get(ai.id);
        if (!existing || existing.type !== 'ai') return;
        const aiTurn = existing as AiTurn;
        if (!aiTurn.synthesisResponses) aiTurn.synthesisResponses = {};
        const next: Record<string, ProviderResponse[]> = { ...aiTurn.synthesisResponses };
        selected.forEach((pid) => {
          const arr = Array.isArray(next[pid]) ? [...next[pid]] : [];
          const initialStatus: 'streaming' | 'pending' = PRIMARY_STREAMING_PROVIDER_IDS.includes(pid) ? 'streaming' : 'pending';
          arr.push({
            providerId: pid as ProviderKey,
            text: '',
            status: initialStatus,
            createdAt: Date.now(),
          });
          next[pid] = arr;
        });
        aiTurn.synthesisResponses = next;
      });

      setActiveAiTurnId(ai.id);
      isSynthRunningRef.current = true;
      setIsLoading(true);
      setUiPhase('streaming');
      setCurrentAppStep('synthesis');

      try {
        // Recompute synthesis from the existing AI turn outputs, one provider at a time
        for (const pid of selected) {
          // Aim recompute state precisely at the current provider/turn
          setActiveRecomputeState({ aiTurnId: ai.id, stepType: 'synthesis', providerId: pid });
          const primitive: PrimitiveWorkflowRequest = {
            type: 'recompute',
            sessionId: currentSessionId as string,
            sourceTurnId: ai.id,
            stepType: 'synthesis',
            targetProvider: pid as ProviderKey,
            useThinking: !!thinkSynthByRound[userTurnId],
          };
          await api.executeWorkflow(primitive);
        }
        if (selected.length === 1) {
          try { localStorage.setItem('htos_last_synthesis_model', selected[0]); } catch {}
        }
      } catch (err) {
        console.error('Synthesis run failed:', err);
        setIsLoading(false);
        setUiPhase('awaiting_action');
        setActiveAiTurnId(null);
        setActiveRecomputeState(null);
      } finally {
        isSynthRunningRef.current = false;
      }
    },
    [
      currentSessionId,
      synthSelectionsByRound,
      findRoundForUserTurn,
      thinkSynthByRound,
      mappingSelectionByRound,
      activeClips,
      setTurnsMap,
      setActiveAiTurnId,
      setIsLoading,
      setUiPhase,
      setCurrentAppStep,
    ]
  );

  const runMappingForRound = useCallback(
    async (userTurnId: string, providerIdOverride?: string) => {
      if (!currentSessionId) return;

      const roundInfo = findRoundForUserTurn(userTurnId);
      if (!roundInfo?.user || !roundInfo.ai) return;

      const userTurn = roundInfo.user as UserTurn;
      const { ai } = roundInfo;

      const outputsFromBatch = Object.values(ai.batchResponses || {}).filter(
        (r: any) => r.status === 'completed' && r.text?.trim()
      );

      const hasCompletedSynthesis = ai?.synthesisResponses
        ? Object.values(ai.synthesisResponses).some((resp) => {
            const responses = Array.isArray(resp) ? resp : [resp];
            return responses.some((r) => r.status === 'completed' && r.text?.trim());
          })
        : false;

      const hasCompletedMapping = ai?.mappingResponses
        ? Object.values(ai.mappingResponses).some((resp) => {
            const responses = Array.isArray(resp) ? resp : [resp];
            return responses.some((r) => r.status === 'completed' && r.text?.trim());
          })
        : false;

      const enoughOutputs = outputsFromBatch.length >= 2 || hasCompletedSynthesis || hasCompletedMapping;
      if (!enoughOutputs) {
        console.warn(`Not enough outputs for mapping in round ${userTurnId}`);
        return;
      }

      const effectiveMappingProvider = providerIdOverride || mappingSelectionByRound[userTurnId];
      if (!effectiveMappingProvider) return;

      setMappingSelectionByRound((draft: Record<string, string | null>) => {
        if (draft[userTurnId] === effectiveMappingProvider) return;
        draft[userTurnId] = effectiveMappingProvider;
      });

      setTurnsMap((draft: Map<string, TurnMessage>) => {
        const existing = draft.get(ai.id);
        if (!existing || existing.type !== 'ai') return;
        const aiTurn = existing as AiTurn;
        const prev = aiTurn.mappingResponses || {};
        const next: Record<string, ProviderResponse[]> = { ...prev };
        const arr = Array.isArray(next[effectiveMappingProvider]) ? [...next[effectiveMappingProvider]] : [];
        const initialStatus: 'streaming' | 'pending' = PRIMARY_STREAMING_PROVIDER_IDS.includes(effectiveMappingProvider) ? 'streaming' : 'pending';
        arr.push({
          providerId: effectiveMappingProvider as ProviderKey,
          text: '',
          status: initialStatus,
          createdAt: Date.now(),
        });
        next[effectiveMappingProvider] = arr;
        aiTurn.mappingResponses = next;
      });

      setActiveAiTurnId(ai.id);
      setIsLoading(true);
      setUiPhase('streaming');
      setCurrentAppStep('synthesis');

      try {
        // Aim recompute state precisely at the mapping provider
        setActiveRecomputeState({ aiTurnId: ai.id, stepType: 'mapping', providerId: effectiveMappingProvider });
        const primitive: PrimitiveWorkflowRequest = {
          type: 'recompute',
          sessionId: currentSessionId as string,
          sourceTurnId: ai.id,
          stepType: 'mapping',
          targetProvider: effectiveMappingProvider as ProviderKey,
          useThinking: effectiveMappingProvider === 'chatgpt' ? !!thinkMappingByRound[userTurnId] : false,
        };
        await api.executeWorkflow(primitive);
      } catch (err) {
        console.error('Mapping run failed:', err);
        setIsLoading(false);
        setUiPhase('awaiting_action');
        setActiveAiTurnId(null);
        setActiveRecomputeState(null);
      }
    },
    [
      currentSessionId,
      findRoundForUserTurn,
      mappingSelectionByRound,
      setMappingSelectionByRound,
      thinkMappingByRound,
      setTurnsMap,
      setActiveAiTurnId,
      setIsLoading,
      setUiPhase,
      setCurrentAppStep,
    ]
  );

  // ID-first helpers (direct by aiTurnId to avoid scanning arrays)
  const runSynthesisForAiTurn = useCallback(
    async (aiTurnId: string, providerIdOverride?: string) => {
      const ai = turnsMap.get(aiTurnId) as AiTurn | undefined;
      if (!ai || ai.type !== 'ai') return;
      // Prefer canonical userTurnId from adjacency in turnIds
      let userTurnId = ai.userTurnId;
      const idx = turnIds.indexOf(aiTurnId);
      if (idx > 0) {
        const prevId = turnIds[idx - 1];
        const prev = turnsMap.get(prevId);
        if (prev && prev.type === 'user') {
          userTurnId = (prev as UserTurn).id;
        }
      }
      await runSynthesisForRound(userTurnId, providerIdOverride);
    },
    [turnsMap, turnIds, runSynthesisForRound]
  );

  const runMappingForAiTurn = useCallback(
    async (aiTurnId: string, providerIdOverride?: string) => {
      const ai = turnsMap.get(aiTurnId) as AiTurn | undefined;
      if (!ai || ai.type !== 'ai') return;
      // Prefer canonical userTurnId from adjacency in turnIds
      let userTurnId = ai.userTurnId;
      const idx = turnIds.indexOf(aiTurnId);
      if (idx > 0) {
        const prevId = turnIds[idx - 1];
        const prev = turnsMap.get(prevId);
        if (prev && prev.type === 'user') {
          userTurnId = (prev as UserTurn).id;
        }
      }
      await runMappingForRound(userTurnId, providerIdOverride);
    },
    [turnsMap, turnIds, runMappingForRound]
  );

  const toggleSynthForRound = useCallback(
    (userTurnId: string, providerId: string) => {
      setSynthSelectionsByRound((draft: Record<string, Record<string, boolean>>) => {
        const current = draft[userTurnId] || {};
        draft[userTurnId] = { ...current, [providerId]: !current[providerId] };
      });
    },
    [setSynthSelectionsByRound]
  );

  const selectMappingForRound = useCallback(
    (userTurnId: string, providerId: string) => {
      setMappingSelectionByRound((draft: Record<string, string | null>) => {
        draft[userTurnId] = draft[userTurnId] === providerId ? null : providerId;
      });
    },
    [setMappingSelectionByRound]
  );

  return {
    runSynthesisForRound,
    runMappingForRound,
    runSynthesisForAiTurn,
    runMappingForAiTurn,
    toggleSynthForRound,
    selectMappingForRound,
  };
}
