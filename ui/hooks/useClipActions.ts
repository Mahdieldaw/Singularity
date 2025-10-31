import { useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { messagesAtom, activeClipsAtom, alertTextAtom } from '../state/atoms';
import { useSetAtom as useSetJotaiAtom } from 'jotai';
import { useRoundActions } from './useRoundActions';
import type { AiTurn, TurnMessage } from '../types';

export function useClipActions() {
  const messages = useAtomValue(messagesAtom);
  const activeClips = useAtomValue(activeClipsAtom);
  const setActiveClips = useSetAtom(activeClipsAtom);
  const setAlertText = useSetAtom(alertTextAtom);
  const setMessages = useSetJotaiAtom(messagesAtom as any);
  const { runSynthesisForRound, runMappingForRound } = useRoundActions();

  const handleClipClick = useCallback(async (aiTurnId: string, type: 'synthesis' | 'mapping', providerId: string) => {
    const aiTurn = messages.find((m: TurnMessage) => m.type === 'ai' && (m as AiTurn).id === aiTurnId) as AiTurn | undefined;
    if (!aiTurn) return;

    const responsesMap = type === 'synthesis' ? (aiTurn.synthesisResponses || {}) : (aiTurn.mappingResponses || {});
    const hasExisting = Array.isArray(responsesMap[providerId])
      ? (responsesMap[providerId] as any).length > 0
      : !!responsesMap[providerId];

    // Use Immer-style setter provided by atomWithImmer
    setActiveClips((draft: Record<string, { synthesis?: string; mapping?: string }>) => {
      draft[aiTurnId] = { ...(draft[aiTurnId] || {}), [type]: providerId };
    });

    // If the selected provider is not present in the AI turn's batchResponses, add an optimistic pending
    // batch response so the batch count increases and the model shows up in the batch area.
    if (!aiTurn.batchResponses || !aiTurn.batchResponses[providerId]) {
      setMessages((draft: any) => {
        const turn = draft.find((t: any) => t.type === 'ai' && (t as AiTurn).id === aiTurnId) as AiTurn | undefined;
        if (!turn) return;
        turn.batchResponses = turn.batchResponses || {};
        // Only add if still missing (concurrent updates may have added it)
        if (!turn.batchResponses[providerId]) {
          turn.batchResponses[providerId] = {
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

      if (!userTurnId) return;
      await runSynthesisForRound(userTurnId, providerId);
    } else {
      if (!userTurnId) return;
      await runMappingForRound(userTurnId, providerId);
    }
  }, [messages, runSynthesisForRound, runMappingForRound, setActiveClips, setAlertText]);

  return { handleClipClick, activeClips };
}
