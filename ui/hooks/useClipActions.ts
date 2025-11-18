import { useCallback } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { activeClipsAtom, alertTextAtom, turnsMapAtom } from "../state/atoms";
import { useRoundActions } from "./useRoundActions";
import type { AiTurn } from "../types";
import { PRIMARY_STREAMING_PROVIDER_IDS } from "../constants";

export function useClipActions() {
  const turnsMap = useAtomValue(turnsMapAtom);
  const activeClips = useAtomValue(activeClipsAtom);
  const setActiveClips = useSetAtom(activeClipsAtom);
  const setAlertText = useSetAtom(alertTextAtom);
  const setTurnsMap = useSetAtom(turnsMapAtom);
  const { runSynthesisForAiTurn, runMappingForAiTurn } = useRoundActions();

  const handleClipClick = useCallback(
    async (
      aiTurnId: string,
      type: "synthesis" | "mapping",
      providerId: string,
    ) => {
      const aiTurn = turnsMap.get(aiTurnId) as AiTurn | undefined;
      if (!aiTurn || aiTurn.type !== "ai") {
        setAlertText("Cannot find AI turn. Please try again.");
        return;
      }

      // Validate turn is finalized before allowing historical reruns
      const isOptimistic = aiTurn.meta?.isOptimistic === true;
      if (!aiTurn.userTurnId || isOptimistic) {
        setAlertText(
          "Turn data is still loading. Please wait a moment and try again.",
        );
        console.warn("[ClipActions] Attempted rerun on unfinalized turn:", {
          aiTurnId,
          hasUserTurnId: !!aiTurn.userTurnId,
          isOptimistic,
        });
        return;
      }

      const responsesMap =
        type === "synthesis"
          ? aiTurn.synthesisResponses || {}
          : aiTurn.mappingResponses || {};
      const responseEntry = responsesMap[providerId];
      const hasExisting =
        Array.isArray(responseEntry) && responseEntry.length > 0;

      setActiveClips((prev) => ({
        ...prev,
        [aiTurnId]: {
          ...(prev?.[aiTurnId] || {}),
          [type]: providerId,
        },
      }));

      // If the selected provider is not present in the AI turn's batchResponses, add an optimistic
      // batch response so the batch count increases and the model shows up in the batch area.
      if (!aiTurn.batchResponses || !aiTurn.batchResponses[providerId]) {
        setTurnsMap((draft) => {
          const turn = draft.get(aiTurnId) as AiTurn | undefined;
          if (!turn || turn.type !== "ai") return;
          turn.batchResponses = (turn.batchResponses || {}) as any;
          if (!turn.batchResponses[providerId]) {
            const initialStatus: "streaming" | "pending" =
              PRIMARY_STREAMING_PROVIDER_IDS.includes(providerId)
                ? "streaming"
                : "pending";
            (turn.batchResponses as any)[providerId] = {
              providerId,
              text: "",
              status: initialStatus,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            } as any;
          }
        });
      }

      if (hasExisting) return;

      if (type === "synthesis") {
        // For historical turns, allow synthesis even if mapping doesn't exist yet
        const isHistoricalTurn =
          !aiTurn.batchResponses ||
          Object.keys(aiTurn.batchResponses).length === 0;
        if (!isHistoricalTurn) {
          const mappingResponses = aiTurn.mappingResponses || {};
          const hasCompletedMapping = Object.values(mappingResponses).some(
            (value: any) => {
              const arr = Array.isArray(value) ? value : [value];
              const last = arr[arr.length - 1];
              return !!(
                last &&
                last.status === "completed" &&
                last.text?.trim()
              );
            },
          );
          if (!hasCompletedMapping) {
            setAlertText(
              "No mapping result exists for this round. Run mapping first before synthesizing.",
            );
            return;
          }
        }
        await runSynthesisForAiTurn(aiTurnId, providerId);
      } else {
        await runMappingForAiTurn(aiTurnId, providerId);
      }
    },
    [
      turnsMap,
      runSynthesisForAiTurn,
      runMappingForAiTurn,
      setActiveClips,
      setAlertText,
      setTurnsMap,
    ],
  );

  return { handleClipClick, activeClips };
}
