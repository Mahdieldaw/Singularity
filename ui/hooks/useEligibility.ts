// ui/hooks/useEligibility.ts
import { useMemo, useCallback } from "react";
import { useAtomValue } from "jotai";
import { messagesAtom } from "../state/atoms";
import type { AiTurn, UserTurn } from "../types";

export interface EligibilityMap {
  synthMap: Record<string, { disabled: boolean; reason?: string }>;
  mappingMap: Record<string, { disabled: boolean; reason?: string }>;
  disableSynthesisRun: boolean;
  disableMappingRun: boolean;
}

export function useEligibility() {
  const messages = useAtomValue(messagesAtom);

  const findRoundForUserTurn = useCallback(
    (userTurnId: string) => {
      const userIndex = messages.findIndex(
        (m) => m.id === userTurnId && m.type === "user",
      );
      if (userIndex === -1) return null;

      let aiIndex = -1;
      for (let i = userIndex + 1; i < messages.length; i++) {
        const t = messages[i];
        if (t.type === "user") break;
        if (t.type === "ai") {
          const ai = t as AiTurn;
          if (!ai.isSynthesisAnswer && !ai.isMappingAnswer) {
            aiIndex = i;
            break;
          }
        }
      }
      const ai = aiIndex !== -1 ? (messages[aiIndex] as AiTurn) : undefined;
      return { userIndex, user: messages[userIndex] as UserTurn, aiIndex, ai };
    },
    [messages],
  );

  const buildEligibilityForRound = useCallback(
    (userTurnId: string): EligibilityMap => {
      const round = findRoundForUserTurn(userTurnId);
      if (!round || !round.ai) {
        return {
          synthMap: {},
          mappingMap: {},
          disableSynthesisRun: true,
          disableMappingRun: true,
        };
      }

      const { ai } = round;

      // Ensure all response objects exist
      if (!ai.batchResponses) ai.batchResponses = {};
      if (!ai.synthesisResponses) ai.synthesisResponses = {};
      if (!ai.mappingResponses) ai.mappingResponses = {};

      // More robust batch response checking
      const batchResponses = ai.batchResponses || {};
      const completedBatchOutputs = Object.values(batchResponses).filter(
        (r: any) =>
          r && r.status === "completed" && r.text && r.text.trim().length > 0,
      );

      // Check for any evidence of past successful runs
      const hasAnyCompletedResponses =
        completedBatchOutputs.length > 0 ||
        Object.values(ai.synthesisResponses).some((resp) => {
          const responses = Array.isArray(resp) ? resp : [resp];
          return responses.some(
            (r) => r.status === "completed" && r.text?.trim(),
          );
        }) ||
        Object.values(ai.mappingResponses).some((resp) => {
          const responses = Array.isArray(resp) ? resp : [resp];
          return responses.some(
            (r) => r.status === "completed" && r.text?.trim(),
          );
        });

      // For historical turns, be more lenient - if we have ANY completed responses,
      // allow synthesis/mapping (the backend will handle the actual requirements)
      const enoughOutputs =
        completedBatchOutputs.length >= 2 || hasAnyCompletedResponses;

      // Rest of the function remains the same...
      const alreadyMappingPids = Object.keys(ai.mappingResponses);

      const synthMap: Record<string, { disabled: boolean; reason?: string }> =
        {};
      const PROVIDERS = ["claude", "gemini", "chatgpt", "xai", "qwen"];

      PROVIDERS.forEach((p) => {
        if (!enoughOutputs) {
          synthMap[p] = {
            disabled: true,
            reason: "Need ≥ 2 model outputs in this round",
          };
        } else {
          synthMap[p] = { disabled: false };
        }
      });

      const mappingMap: Record<string, { disabled: boolean; reason?: string }> =
        {};
      PROVIDERS.forEach((p) => {
        const alreadyMapping = alreadyMappingPids.includes(p);
        if (!enoughOutputs) {
          mappingMap[p] = {
            disabled: true,
            reason: "Need ≥ 2 model outputs in this round",
          };
        } else if (alreadyMapping) {
          mappingMap[p] = {
            disabled: true,
            reason: "Already mapped for this round",
          };
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
    },
    [findRoundForUserTurn],
  );

  // Memoized map for all rounds
  const eligibilityMaps = useMemo(() => {
    const maps: Record<string, EligibilityMap> = {};
    messages.forEach((turn) => {
      if (turn.type === "user") {
        maps[turn.id] = buildEligibilityForRound(turn.id);
      }
    });
    return maps;
  }, [messages, buildEligibilityForRound]);

  return { eligibilityMaps, buildEligibilityForRound };
}
