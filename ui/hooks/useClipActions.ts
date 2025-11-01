import { useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { messagesAtom, activeClipsAtom, alertTextAtom, turnsMapAtom } from '../state/atoms';
import { useRoundActions } from './useRoundActions';
import type { AiTurn, TurnMessage } from '../types';

export function useClipActions() {
  const messages = useAtomValue(messagesAtom);
  const activeClips = useAtomValue(activeClipsAtom);
  const setActiveClips = useSetAtom(activeClipsAtom);
  const setAlertText = useSetAtom(alertTextAtom);
  const setTurnsMap = useSetAtom(turnsMapAtom);
  const { runSynthesisForRound, runMappingForRound } = useRoundActions();

  const handleClipClick = useCallback(async (aiTurnId: string, type: 'synthesis' | 'mapping', providerId: string) => {
    const aiTurn = messages.find((m: TurnMessage) => m.type === 'ai' && (m as AiTurn).id === aiTurnId) as AiTurn | undefined;
    if (!aiTurn) return;

    const responsesMap = type === 'synthesis' ? (aiTurn.synthesisResponses || {}) : (aiTurn.mappingResponses || {});
    const responseEntry = responsesMap[providerId];
    const hasExisting = Array.isArray(responseEntry) && responseEntry.length > 0;

    setActiveClips((prev) => ({
      ...prev,
      [aiTurnId]: {
        ...(prev?.[aiTurnId] || {}),
        [type]: providerId,
      },
    }));

    // If the selected provider is not present in the AI turn's batchResponses, add an optimistic pending
    // batch response so the batch count increases and the model shows up in the batch area.
    if (!aiTurn.batchResponses || !aiTurn.batchResponses[providerId]) {
      setTurnsMap((draft) => {
        const turn = draft.get(aiTurnId) as AiTurn | undefined;
        if (!turn || turn.type !== 'ai') return;
        turn.batchResponses = turn.batchResponses || {} as any;
        if (!turn.batchResponses[providerId]) {
          (turn.batchResponses as any)[providerId] = {
            providerId,
            text: '',
            status: 'pending',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          } as any;
        }
      });
    }

    const userTurnId = aiTurn.userTurnId;
    if (type === 'mapping' && userTurnId) {
      // update mapping selection per round
      // mapping selection atom updated inside runMappingForRound or separately by consumers
    }

    if (hasExisting) return;

    if (type === 'synthesis') {
    // For historical turns, allow synthesis even if mapping doesn't exist yet
    // The backend will handle the mapping requirement appropriately
    const isHistoricalTurn = !aiTurn.batchResponses || Object.keys(aiTurn.batchResponses).length === 0;
    
    if (!isHistoricalTurn) {
      // Only enforce mapping requirement for non-historical turns
      const mappingResponses = aiTurn.mappingResponses || {};
      const hasCompletedMapping = Object.values(mappingResponses).some((value: any) => {
        const arr = Array.isArray(value) ? value : [value];
        const last = arr[arr.length - 1];
        return !!(last && last.status === 'completed' && last.text?.trim());
      });

      if (!hasCompletedMapping) {
        setAlertText('No mapping result exists for this round. Run mapping first before synthesizing.');
        return;
      }
    }

      if (!userTurnId) return;
      await runSynthesisForRound(userTurnId, providerId);
    } else {
      if (!userTurnId) return;
      await runMappingForRound(userTurnId, providerId);
    }
  }, [messages, runSynthesisForRound, runMappingForRound, setActiveClips, setAlertText, setTurnsMap]);

  return { handleClipClick, activeClips };
}
