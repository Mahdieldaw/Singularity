// ui/hooks/useEligibility.ts
import { useMemo, useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { messagesAtom } from '../state/atoms';
import type { AiTurn, UserTurn } from '../types';

export interface EligibilityMap {
  synthMap: Record<string, { disabled: boolean; reason?: string }>;
  mappingMap: Record<string, { disabled: boolean; reason?: string }>;
  disableSynthesisRun: boolean;
  disableMappingRun: boolean;
}

export function useEligibility() {
  const messages = useAtomValue(messagesAtom);

  const findRoundForUserTurn = useCallback((userTurnId: string) => {
    const userIndex = messages.findIndex(m => m.id === userTurnId && m.type === 'user');
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
    return { userIndex, user: messages[userIndex] as UserTurn, aiIndex, ai };
  }, [messages]);

  const buildEligibilityForRound = useCallback((userTurnId: string): EligibilityMap => {
    const round = findRoundForUserTurn(userTurnId);
    if (!round) {
      return {
        synthMap: {},
        mappingMap: {},
        disableSynthesisRun: true,
        disableMappingRun: true,
      };
    }

    const { ai } = round;
    const outputs = Object.values(ai?.providerResponses || {}).filter(
      r => r.status === 'completed' && r.text?.trim()
    );
    const enoughOutputs = outputs.length >= 2;

    const alreadySynthPids = ai?.synthesisResponses ? Object.keys(ai.synthesisResponses) : [];
    const alreadyMappingPids = ai?.mappingResponses ? Object.keys(ai.mappingResponses) : [];

    const hasCompletedMapping = (() => {
      if (!ai?.mappingResponses) return false;
      for (const [pid, resp] of Object.entries(ai.mappingResponses)) {
        const arr = Array.isArray(resp) ? resp : [resp];
        const last = arr[arr.length - 1];
        if (last && last.status === 'completed' && last.text?.trim()) return true;
      }
      return false;
    })();

    // Build synthesis eligibility
    const synthMap: Record<string, { disabled: boolean; reason?: string }> = {};
    const PROVIDERS = ['claude', 'gemini', 'chatgpt', 'xai', 'qwen']; // Import from constants
    PROVIDERS.forEach(p => {
      const alreadySynth = alreadySynthPids.includes(p);
      if (!enoughOutputs) {
        synthMap[p] = { disabled: true, reason: 'Need ≥ 2 model outputs in this round' };
      } else if (alreadySynth) {
        synthMap[p] = { disabled: true, reason: 'Already synthesized for this round' };
      } else {
        synthMap[p] = { disabled: false };
      }
    });

    // Build mapping eligibility
    const mappingMap: Record<string, { disabled: boolean; reason?: string }> = {};
    PROVIDERS.forEach(p => {
      const alreadyMapping = alreadyMappingPids.includes(p);
      if (!enoughOutputs) {
        mappingMap[p] = { disabled: true, reason: 'Need ≥ 2 model outputs in this round' };
      } else if (alreadyMapping) {
        mappingMap[p] = { disabled: true, reason: 'Already mapped for this round' };
      } else {
        mappingMap[p] = { disabled: false };
      }
    });

    return {
      synthMap,
      mappingMap,
      disableSynthesisRun: !enoughOutputs,
      disableMappingRun: !enoughOutputs,
    };
  }, [findRoundForUserTurn]);

  // Memoized map for all rounds
  const eligibilityMaps = useMemo(() => {
    const maps: Record<string, EligibilityMap> = {};
    messages.forEach(turn => {
      if (turn.type === 'user') {
        maps[turn.id] = buildEligibilityForRound(turn.id);
      }
    });
    return maps;
  }, [messages, buildEligibilityForRound]);

  return { eligibilityMaps, buildEligibilityForRound };
}