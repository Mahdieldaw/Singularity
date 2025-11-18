// ui/hooks/usePortMessageHandler.ts - ALIGNED VERSION
import { useCallback, useRef, useEffect } from "react";
import { useSetAtom, useAtomValue } from "jotai";
import {
  turnsMapAtom,
  turnIdsAtom,
  currentSessionIdAtom,
  isLoadingAtom,
  uiPhaseAtom,
  activeAiTurnIdAtom,
  providerContextsAtom,
  selectedModelsAtom,
  mappingEnabledAtom,
  mappingProviderAtom,
  synthesisProviderAtom,
  lastActivityAtAtom,
} from "../state/atoms";
import { activeRecomputeStateAtom } from "../state/atoms";
import { StreamingBuffer } from "../utils/streamingBuffer";
import {
  applyStreamingUpdates,
  createOptimisticAiTurn,
} from "../utils/turn-helpers";
import api from "../services/extension-api";
import type { TurnMessage, UserTurn, AiTurn, ProviderKey } from "../types";
import { LLM_PROVIDERS_CONFIG } from "../constants";

/**
 * CRITICAL: Step type detection must match backend stepId patterns
 * Backend generates: 'batch-<timestamp>', 'synthesis-<provider>-<timestamp>', 'mapping-<provider>-<timestamp>'
 */
function getStepType(stepId: string): "batch" | "synthesis" | "mapping" | null {
  if (!stepId || typeof stepId !== "string") return null;

  // Match backend patterns exactly
  if (stepId.startsWith("synthesis-") || stepId.includes("-synthesis-"))
    return "synthesis";
  if (stepId.startsWith("mapping-") || stepId.includes("-mapping-"))
    return "mapping";
  if (stepId.startsWith("batch-") || stepId.includes("prompt")) return "batch";

  console.warn(`[Port] Unknown stepId pattern: ${stepId}`);
  return null;
}

/**
 * Extract provider ID from stepId for synthesis/mapping steps
 * Backend format: 'synthesis-gemini-1234567890' or 'mapping-chatgpt-1234567890'
 */
function extractProviderFromStepId(
  stepId: string,
  stepType: "synthesis" | "mapping",
): string | null {
  // Support provider IDs with hyphens/dots/etc., assuming last segment is numeric timestamp
  const re = new RegExp(`^${stepType}-(.+)-(\\d+)$`);
  const match = stepId.match(re);
  return match ? match[1] : null;
}

export function usePortMessageHandler() {
  const setTurnsMap = useSetAtom(turnsMapAtom);
  const setTurnIds = useSetAtom(turnIdsAtom);
  const setCurrentSessionId = useSetAtom(currentSessionIdAtom);
  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const setIsLoading = useSetAtom(isLoadingAtom);
  const setUiPhase = useSetAtom(uiPhaseAtom);
  const activeAiTurnId = useAtomValue(activeAiTurnIdAtom);
  const setActiveAiTurnId = useSetAtom(activeAiTurnIdAtom);
  const setProviderContexts = useSetAtom(providerContextsAtom);
  const selectedModels = useAtomValue(selectedModelsAtom);
  const mappingEnabled = useAtomValue(mappingEnabledAtom);
  const mappingProvider = useAtomValue(mappingProviderAtom);
  const synthesisProvider = useAtomValue(synthesisProviderAtom);
  const setLastActivityAt = useSetAtom(lastActivityAtAtom);
  // Note: We rely on Jotai's per-atom update serialization; no manual pending cache

  const streamingBufferRef = useRef<StreamingBuffer | null>(null);
  const activeAiTurnIdRef = useRef<string | null>(null);
  const activeRecomputeRef = useRef<{
    aiTurnId: string;
    stepType: "synthesis" | "mapping";
    providerId: string;
  } | null>(null);
  // Track whether we've already logged the first PARTIAL_RESULT for a given
  // stepId/providerId pair to avoid noisy, repeated logs in devtools.
  const partialLoggedRef = useRef<Map<string, Set<string>>>(new Map());

  // Keep ref in sync with atom
  useEffect(() => {
    activeAiTurnIdRef.current = activeAiTurnId;
  }, [activeAiTurnId]);

  const activeRecomputeState = useAtomValue(activeRecomputeStateAtom);
  const setActiveRecomputeState = useSetAtom(activeRecomputeStateAtom);
  useEffect(() => {
    activeRecomputeRef.current = activeRecomputeState;
  }, [activeRecomputeState]);

  const handler = useCallback(
    (message: any) => {
      if (!message || !message.type) return;

      // Reduce noise: do not dump full PARTIAL_RESULT objects repeatedly
      if (message.type !== "PARTIAL_RESULT") {
        console.log("[Port Handler]", message.type, message);
      }

      switch (message.type) {
        // SESSION_STARTED is deprecated. UI now initializes session from TURN_CREATED.

        case "TURN_CREATED": {
          const { userTurnId, aiTurnId, sessionId: msgSessionId } = message;

          // Always adopt the backend sessionId for TURN_CREATED
          if (msgSessionId) {
            if (!currentSessionId || currentSessionId === msgSessionId) {
              setCurrentSessionId(msgSessionId);
              try {
                api.setSessionId(msgSessionId);
              } catch {}
            }
          }

          // Compute active providers at the time of creation
          const activeProviders = LLM_PROVIDERS_CONFIG.filter(
            (p) => selectedModels[p.id],
          ).map((p) => p.id as ProviderKey);

          // Single atomic update to turnsMap ensures we read the latest user turn
          setTurnsMap((draft: Map<string, TurnMessage>) => {
            const existing = draft.get(userTurnId);
            if (!existing || existing.type !== "user") {
              // Under Jotai's per-atom serialization, the user turn should be present.
              // If not, avoid creating the AI turn prematurely.
              console.error(
                "[Port] TURN_CREATED: user turn missing in updater for",
                userTurnId,
              );
              return;
            }
            const existingUser = existing as UserTurn;
            const ensuredUser: UserTurn = {
              ...existingUser,
              sessionId:
                existingUser.sessionId ||
                msgSessionId ||
                currentSessionId ||
                null,
            };
            // Backfill sessionId if it was missing
            draft.set(userTurnId, ensuredUser);

            const aiTurn = createOptimisticAiTurn(
              aiTurnId,
              ensuredUser,
              activeProviders,
              !!synthesisProvider,
              !!mappingEnabled && !!mappingProvider,
              synthesisProvider || undefined,
              mappingProvider || undefined,
              Date.now(),
              ensuredUser.id,
              {
                synthesis: !!synthesisProvider,
                mapping: !!mappingEnabled && !!mappingProvider,
              },
            );
            draft.set(aiTurnId, aiTurn);
          });

          // Ensure ordering in ID list (user first, then AI)
          setTurnIds((idsDraft: string[]) => {
            if (!idsDraft.includes(userTurnId)) idsDraft.push(userTurnId);
            if (!idsDraft.includes(aiTurnId)) idsDraft.push(aiTurnId);
          });

          setActiveAiTurnId(aiTurnId);
          setLastActivityAt(Date.now());
          break;
        }

        case "TURN_FINALIZED": {
          const {
            userTurnId,
            aiTurnId,
            turn,
            sessionId: msgSessionId,
          } = message;

          // Adopt sessionId on finalization to ensure coherence
          if (msgSessionId) {
            if (!currentSessionId || currentSessionId === msgSessionId) {
              setCurrentSessionId(msgSessionId);
              try {
                api.setSessionId(msgSessionId);
              } catch {}
            }
          }

          console.log("[Port] Received TURN_FINALIZED", {
            userTurnId,
            aiTurnId,
            hasUserData: !!turn?.user,
            hasAiData: !!turn?.ai,
            aiHasUserTurnId: !!turn?.ai?.userTurnId,
          });

          // Flush any pending streaming data first
          streamingBufferRef.current?.flushImmediate?.();

          // Merge canonical data into existing turns (no ID remapping needed)
          setTurnsMap((draft: Map<string, TurnMessage>) => {
            // Update user turn if provided
            if (turn?.user) {
              const existingUser = draft.get(turn.user.id) as
                | UserTurn
                | undefined;
              draft.set(turn.user.id, {
                ...(existingUser || {}),
                ...(turn.user as UserTurn),
              });
            }

            if (turn?.ai) {
              const existingAi = draft.get(aiTurnId) as AiTurn | undefined;
              if (!existingAi) {
                // Fallback: if the AI turn wasn't created (should be rare), add it directly
                draft.set(aiTurnId, turn.ai as AiTurn);
              } else {
                const mergedAi: AiTurn = {
                  ...existingAi,
                  ...(turn.ai as AiTurn),
                  type: "ai",
                  userTurnId: turn.user?.id || existingAi.userTurnId,
                  batchResponses: {
                    ...(existingAi.batchResponses || {}),
                    ...((turn.ai as AiTurn)?.batchResponses || {}),
                  },
                  synthesisResponses: {
                    ...(existingAi.synthesisResponses || {}),
                    ...((turn.ai as AiTurn)?.synthesisResponses || {}),
                  },
                  mappingResponses: {
                    ...(existingAi.mappingResponses || {}),
                    ...((turn.ai as AiTurn)?.mappingResponses || {}),
                  },
                  meta: {
                    ...(existingAi.meta || {}),
                    ...((turn.ai as AiTurn)?.meta || {}),
                    isOptimistic: false,
                  },
                };
                draft.set(aiTurnId, mergedAi);
              }
            }
          });

          // Ensure canonical IDs exist in turnIds (no remapping)
          setTurnIds((idsDraft: string[]) => {
            const ensureId = (id: string | undefined) => {
              if (!id) return;
              if (!idsDraft.includes(id)) idsDraft.push(id);
            };
            ensureId(turn?.user?.id);
            ensureId(aiTurnId);
            // Deduplicate while preserving the first occurrence
            const seen = new Set<string>();
            for (let i = idsDraft.length - 1; i >= 0; i--) {
              const id = idsDraft[i];
              if (seen.has(id)) {
                idsDraft.splice(i, 1);
              } else {
                seen.add(id);
              }
            }
          });

          // Finalization UI state updates
          setIsLoading(false);
          setUiPhase("awaiting_action");
          // Clear active AI turn only after finalization (not in WORKFLOW_COMPLETE)
          setActiveAiTurnId(null);
          setLastActivityAt(Date.now());

          break;
        }

        case "PARTIAL_RESULT": {
          const {
            stepId,
            providerId,
            chunk,
            sessionId: msgSessionId,
          } = message;
          if (!chunk?.text) return;

          const stepType = getStepType(stepId);
          if (!stepType) {
            console.warn(`[Port] Cannot determine step type for: ${stepId}`);
            return;
          }

          // Some backends omit providerId for synthesis/mapping partials; derive from stepId if needed
          let pid: string | null | undefined = providerId;
          if (
            (!pid || typeof pid !== "string") &&
            (stepType === "synthesis" || stepType === "mapping")
          ) {
            pid = extractProviderFromStepId(stepId, stepType);
          }
          if (!pid) {
            if (STREAMING_DEBUG_UI) {
              console.warn(
                `[Port] PARTIAL_RESULT missing providerId and could not be derived for step ${stepId}`,
              );
            }
            return;
          }

          // Log the first partial per provider per step only
          try {
            let perStep = partialLoggedRef.current.get(stepId);
            if (!perStep) {
              perStep = new Set<string>();
              partialLoggedRef.current.set(stepId, perStep);
            }
            if (!perStep.has(pid as string)) {
              const preview =
                typeof chunk?.text === "string" ? chunk.text.slice(0, 200) : "";
              console.log("[Port Handler] PARTIAL_RESULT (first)", {
                stepId,
                providerId: pid,
                preview,
              });
              perStep.add(pid as string);
            }
          } catch (e) {
            // non-fatal
          }

          // Initialize buffer if needed
          if (!streamingBufferRef.current) {
            streamingBufferRef.current = new StreamingBuffer((updates) => {
              const activeId =
                activeRecomputeRef.current?.aiTurnId ||
                activeAiTurnIdRef.current;
              if (!activeId || !updates || updates.length === 0) return;

              setTurnsMap((draft: Map<string, TurnMessage>) => {
                const existing = draft.get(activeId);
                if (!existing || existing.type !== "ai") return;
                const aiTurn = existing as AiTurn;

                // Apply batched updates
                applyStreamingUpdates(aiTurn, updates);

                // CRITICAL: ensure the Map entry is observed as changed
                draft.set(activeId, { ...aiTurn });
              });
            });
          }

          streamingBufferRef.current.addDelta(
            pid,
            chunk.text,
            "streaming",
            stepType,
          );
          setLastActivityAt(Date.now());

          // Store provider context in separate atom
          if (chunk.meta) {
            setProviderContexts((draft: Record<string, any>) => {
              draft[pid as string] = {
                ...(draft[pid as string] || {}),
                ...chunk.meta,
              };
            });
          }
          break;
        }

        case "WORKFLOW_STEP_UPDATE": {
          const {
            stepId,
            status,
            result,
            error,
            sessionId: msgSessionId,
          } = message;

          // Clean up once a step completes/fails to avoid memory growth
          if (status === "completed" || status === "failed") {
            try {
              partialLoggedRef.current.delete(stepId);
            } catch {}
          }

          // Do not gate by session; process updates irrespective of UI session state

          if (status === "completed" && result) {
            streamingBufferRef.current?.flushImmediate();
            setLastActivityAt(Date.now());

            // ✅ CRITICAL FIX: Properly detect step type and route completions
            const stepType = getStepType(stepId);

            if (!stepType) {
              console.error(
                `[Port] Cannot route completion - unknown stepId: ${stepId}`,
              );
              break;
            }

            // Backend sends either:
            // 1. { results: { claude: {...}, gemini: {...} } } for batch steps
            // 2. { providerId: 'gemini', text: '...', status: '...' } for single-provider steps
            const resultsMap =
              result.results ||
              (result.providerId ? { [result.providerId]: result } : {});

            const _completedProviders: string[] = [];
            Object.entries(resultsMap).forEach(
              ([providerId, data]: [string, any]) => {
                const targetId = activeAiTurnIdRef.current;
                if (!targetId) return;
                _completedProviders.push(providerId);

                setTurnsMap((draft: Map<string, TurnMessage>) => {
                  const existing = draft.get(targetId);
                  if (!existing || existing.type !== "ai") return;
                  const aiTurn = existing as AiTurn;

                  const completedEntry = {
                    providerId,
                    text: data?.text || "",
                    status: "completed" as const,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    meta: data?.meta || {},
                  };

                  if (stepType === "synthesis") {
                    const arr = Array.isArray(
                      aiTurn.synthesisResponses?.[providerId],
                    )
                      ? [...(aiTurn.synthesisResponses![providerId] as any[])]
                      : [];
                    if (arr.length > 0) {
                      arr[arr.length - 1] = {
                        ...(arr[arr.length - 1] as any),
                        ...completedEntry,
                      } as any;
                    } else {
                      arr.push(completedEntry as any);
                    }
                    aiTurn.synthesisResponses = {
                      ...(aiTurn.synthesisResponses || {}),
                      [providerId]: arr as any,
                    };
                  } else if (stepType === "mapping") {
                    const arr = Array.isArray(
                      aiTurn.mappingResponses?.[providerId],
                    )
                      ? [...(aiTurn.mappingResponses![providerId] as any[])]
                      : [];
                    if (arr.length > 0) {
                      arr[arr.length - 1] = {
                        ...(arr[arr.length - 1] as any),
                        ...completedEntry,
                      } as any;
                    } else {
                      arr.push(completedEntry as any);
                    }
                    aiTurn.mappingResponses = {
                      ...(aiTurn.mappingResponses || {}),
                      [providerId]: arr as any,
                    };
                  } else if (stepType === "batch") {
                    aiTurn.batchResponses = {
                      ...(aiTurn.batchResponses || {}),
                      [providerId]: {
                        providerId,
                        text: data?.text || "",
                        status: "completed",
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                        meta: data?.meta || {},
                      },
                    } as any;
                  }

                  // CRITICAL: ensure the Map entry is observed as changed
                  draft.set(targetId, { ...aiTurn });
                });

                if (data?.meta) {
                  setProviderContexts((draft: Record<string, any>) => {
                    draft[providerId] = {
                      ...(draft[providerId] || {}),
                      ...data.meta,
                    };
                  });
                }
              },
            );

            // Emit a single aggregated completion log for batch steps to reduce verbosity
            try {
              if (stepType === "batch") {
                const targetId = activeAiTurnIdRef.current;
                if (targetId && _completedProviders.length > 0) {
                  console.log(
                    `[Port] Batch step completed on turn ${targetId} with results from ${_completedProviders.length} providers: ${_completedProviders.join(", ")}`,
                  );
                }
              }
            } catch (_) {}

            if (message.isRecompute) {
              setActiveRecomputeState(null);
            }
          } else if (status === "failed") {
            console.error(`[Port] Step failed: ${stepId}`, error);
            // Update the corresponding response entry to reflect the error
            try {
              const stepType = getStepType(stepId);
              if (stepType) {
                let providerId: string | null | undefined = result?.providerId;
                if (
                  (!providerId || typeof providerId !== "string") &&
                  (stepType === "synthesis" || stepType === "mapping")
                ) {
                  providerId = extractProviderFromStepId(stepId, stepType);
                }
                const targetId =
                  activeRecomputeRef.current?.aiTurnId ||
                  activeAiTurnIdRef.current;
                if (targetId && providerId) {
                  setTurnsMap((draft: Map<string, TurnMessage>) => {
                    const existing = draft.get(targetId);
                    if (!existing || existing.type !== "ai") return;
                    const aiTurn = existing as AiTurn;
                    const errText =
                      typeof error === "string" ? error : result?.text || "";
                    const now = Date.now();

                    if (stepType === "synthesis") {
                      const arr = Array.isArray(
                        aiTurn.synthesisResponses?.[providerId!],
                      )
                        ? [
                            ...(aiTurn.synthesisResponses![
                              providerId!
                            ] as any[]),
                          ]
                        : [];
                      if (arr.length > 0) {
                        const latest = arr[arr.length - 1] as any;
                        arr[arr.length - 1] = {
                          ...latest,
                          status: "error",
                          text: errText || (latest?.text ?? ""),
                          updatedAt: now,
                        };
                      } else {
                        arr.push({
                          providerId: providerId!,
                          text: errText || "",
                          status: "error",
                          createdAt: now,
                          updatedAt: now,
                        } as any);
                      }
                      aiTurn.synthesisResponses = {
                        ...(aiTurn.synthesisResponses || {}),
                        [providerId!]: arr as any,
                      };
                    } else if (stepType === "mapping") {
                      const arr = Array.isArray(
                        aiTurn.mappingResponses?.[providerId!],
                      )
                        ? [...(aiTurn.mappingResponses![providerId!] as any[])]
                        : [];
                      if (arr.length > 0) {
                        const latest = arr[arr.length - 1] as any;
                        arr[arr.length - 1] = {
                          ...latest,
                          status: "error",
                          text: errText || (latest?.text ?? ""),
                          updatedAt: now,
                        };
                      } else {
                        arr.push({
                          providerId: providerId!,
                          text: errText || "",
                          status: "error",
                          createdAt: now,
                          updatedAt: now,
                        } as any);
                      }
                      aiTurn.mappingResponses = {
                        ...(aiTurn.mappingResponses || {}),
                        [providerId!]: arr as any,
                      };
                    } else if (stepType === "batch") {
                      const existingBatch = (aiTurn.batchResponses || {})[
                        providerId!
                      ];
                      aiTurn.batchResponses = {
                        ...(aiTurn.batchResponses || {}),
                        [providerId!]: {
                          providerId: providerId!,
                          text: errText || existingBatch?.text || "",
                          status: "error",
                          createdAt: existingBatch?.createdAt || now,
                          updatedAt: now,
                          meta: existingBatch?.meta || {},
                        },
                      } as any;
                    }
                  });
                }
              }
            } catch (e) {
              console.warn(
                "[Port] Failed to tag error state on turn response",
                e,
              );
            }

            setIsLoading(false);
            setUiPhase("awaiting_action");
            setLastActivityAt(Date.now());
            // On failure, clear recompute target so UI stops indicating loading
            if (message.isRecompute) {
              setActiveRecomputeState(null);
            }
          }
          break;
        }

        case "WORKFLOW_COMPLETE": {
          const { sessionId: msgSessionId } = message;

          streamingBufferRef.current?.flushImmediate();
          // Fallback finalization is no longer needed.
          // The robust TURN_FINALIZED handler will manage this state change.
          setIsLoading(false);
          setUiPhase("awaiting_action");
          setLastActivityAt(Date.now());
          // Do NOT clear activeAiTurnId here; wait for TURN_FINALIZED
          break;
        }
      }
    },
    [
      setTurnsMap,
      setTurnIds,
      setCurrentSessionId,
      currentSessionId,
      setIsLoading,
      setUiPhase,
      setActiveAiTurnId,
      setProviderContexts,
      selectedModels,
      mappingEnabled,
      mappingProvider,
      synthesisProvider,
    ],
  );

  // Register handler with API
  useEffect(() => {
    api.setPortMessageHandler(handler);
    return () => {
      api.setPortMessageHandler(null);
      streamingBufferRef.current?.clear();
    };
  }, [handler]);

  return { streamingBufferRef };
}
// Minimize streaming log noise in UI; toggle for deep debugging only
const STREAMING_DEBUG_UI = false;
