// ui/hooks/usePortMessageHandler.ts - ALIGNED VERSION
import { useCallback, useRef, useEffect } from 'react';
import { useSetAtom, useAtomValue } from 'jotai';
import { 
  turnsMapAtom,
  turnIdsAtom,
  currentSessionIdAtom, 
  isLoadingAtom,
  uiPhaseAtom,
  activeAiTurnIdAtom,
  isContinuationModeAtom,
  providerContextsAtom,
  selectedModelsAtom,
  mappingEnabledAtom,
  mappingProviderAtom,
  synthesisProviderAtom
} from '../state/atoms';
import { StreamingBuffer } from '../utils/streamingBuffer';
import { applyStreamingUpdates, applyCompletionUpdate, createOptimisticAiTurn } from '../utils/turn-helpers';
import api from '../services/extension-api';
import type { TurnMessage, UserTurn, AiTurn, ProviderKey } from '../types';
import { LLM_PROVIDERS_CONFIG } from '../constants';

/**
 * CRITICAL: Step type detection must match backend stepId patterns
 * Backend generates: 'batch-<timestamp>', 'synthesis-<provider>-<timestamp>', 'mapping-<provider>-<timestamp>'
 */
function getStepType(stepId: string): 'batch' | 'synthesis' | 'mapping' | null {
  if (!stepId || typeof stepId !== 'string') return null;
  
  // Match backend patterns exactly
  if (stepId.startsWith('synthesis-') || stepId.includes('-synthesis-')) return 'synthesis';
  if (stepId.startsWith('mapping-') || stepId.includes('-mapping-')) return 'mapping';
  if (stepId.startsWith('batch-') || stepId.includes('prompt')) return 'batch';
  
  console.warn(`[Port] Unknown stepId pattern: ${stepId}`);
  return null;
}

/**
 * Extract provider ID from stepId for synthesis/mapping steps
 * Backend format: 'synthesis-gemini-1234567890' or 'mapping-chatgpt-1234567890'
 */
function extractProviderFromStepId(stepId: string, stepType: 'synthesis' | 'mapping'): string | null {
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
  const setIsContinuationMode = useSetAtom(isContinuationModeAtom);
  const activeAiTurnId = useAtomValue(activeAiTurnIdAtom);
  const setActiveAiTurnId = useSetAtom(activeAiTurnIdAtom);
  const setProviderContexts = useSetAtom(providerContextsAtom);
  const turnsMap = useAtomValue(turnsMapAtom);
  const selectedModels = useAtomValue(selectedModelsAtom);
  const mappingEnabled = useAtomValue(mappingEnabledAtom);
  const mappingProvider = useAtomValue(mappingProviderAtom);
  const synthesisProvider = useAtomValue(synthesisProviderAtom);
  
  const streamingBufferRef = useRef<StreamingBuffer | null>(null);
  const activeAiTurnIdRef = useRef<string | null>(null);

  // Keep ref in sync with atom
  useEffect(() => {
    activeAiTurnIdRef.current = activeAiTurnId;
  }, [activeAiTurnId]);

  const handler = useCallback((message: any) => {
    if (!message || !message.type) return;
    
    console.log('[Port Handler]', message.type, message);

    switch (message.type) {
      // SESSION_STARTED is deprecated. UI now initializes session from TURN_CREATED.

      case 'TURN_CREATED': {
        const { userTurnId, aiTurnId, sessionId: msgSessionId } = message;

        // Initialize session for new conversations
        if (msgSessionId && (!currentSessionId || currentSessionId === '')) {
          setCurrentSessionId(msgSessionId);
          try { api.setSessionId(msgSessionId); } catch {}
        }

        // Ignore cross-session messages
        if (msgSessionId && currentSessionId && msgSessionId !== currentSessionId) {
          console.warn(`[Port] Ignoring TURN_CREATED from ${msgSessionId} (active ${currentSessionId})`);
          return;
        }

        // Use the hook value, not get(turnsMapAtom)
        const existingUser = turnsMap.get(userTurnId) as UserTurn | undefined;
        if (!existingUser) {
          console.error('[Port] Could not find user turn:', userTurnId);
          return;
        }

        // Backfill sessionId on user turn if missing
        const userTurn: UserTurn = { ...existingUser, sessionId: existingUser.sessionId || msgSessionId || null };
        if (!existingUser.sessionId && msgSessionId) {
          setTurnsMap((draft: Map<string, TurnMessage>) => {
            draft.set(userTurnId, userTurn);
          });
        }

        // Use selectedModels hook value to compute active providers
        const activeProviders = LLM_PROVIDERS_CONFIG
          .filter(p => selectedModels[p.id])
          .map(p => p.id as ProviderKey);

        const aiTurn = createOptimisticAiTurn(
          aiTurnId,
          userTurn,
          activeProviders,
          !!synthesisProvider,
          !!mappingEnabled && !!mappingProvider,
          synthesisProvider || undefined,
          mappingProvider || undefined,
          Date.now(),
          userTurn.id
        );

        setTurnsMap((draft: Map<string, TurnMessage>) => {
          draft.set(aiTurnId, aiTurn);
        });
        setTurnIds((draft: string[]) => {
          draft.push(aiTurnId);
        });
        setActiveAiTurnId(aiTurnId);
        break;
      }

      case 'TURN_FINALIZED': {
        const { userTurnId, aiTurnId, turn, sessionId: msgSessionId } = message;
        
        // Ignore cross-session messages
        if (msgSessionId && currentSessionId && msgSessionId !== currentSessionId) {
          console.warn(`[Port] Ignoring TURN_FINALIZED from ${msgSessionId} (active ${currentSessionId})`);
          return;
        }

        console.log('[Port] Received TURN_FINALIZED', { 
          userTurnId, 
          aiTurnId,
          hasUserData: !!turn?.user,
          hasAiData: !!turn?.ai,
          aiHasUserTurnId: !!turn?.ai?.userTurnId
        });

        // Flush any pending streaming data first
        streamingBufferRef.current?.flushImmediate?.();

        // Merge canonical data into existing turns (no ID remapping needed)
        setTurnsMap((draft: Map<string, TurnMessage>) => {
          // Update user turn if provided
          if (turn?.user) {
            const existingUser = draft.get(turn.user.id) as UserTurn | undefined;
            draft.set(turn.user.id, { ...(existingUser || {}), ...(turn.user as UserTurn) });
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
                type: 'ai',
                userTurnId: turn.user?.id || existingAi.userTurnId,
                batchResponses: { ...(existingAi.batchResponses || {}), ...((turn.ai as AiTurn)?.batchResponses || {}) },
                synthesisResponses: { ...(existingAi.synthesisResponses || {}), ...((turn.ai as AiTurn)?.synthesisResponses || {}) },
                mappingResponses: { ...(existingAi.mappingResponses || {}), ...((turn.ai as AiTurn)?.mappingResponses || {}) },
                meta: { ...(existingAi.meta || {}), ...((turn.ai as AiTurn)?.meta || {}), isOptimistic: false }
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
        setUiPhase('awaiting_action');
        setIsContinuationMode(true);
        // Clear active AI turn only after finalization (not in WORKFLOW_COMPLETE)
        setActiveAiTurnId(null);

        break;
      }

      case 'PARTIAL_RESULT': {
        const { stepId, providerId, chunk, sessionId: msgSessionId } = message;
        if (!chunk?.text) return;

        // Ignore cross-session messages
        if (msgSessionId && currentSessionId && msgSessionId !== currentSessionId) {
          console.warn(`[Port] Ignoring PARTIAL_RESULT from ${msgSessionId} (active ${currentSessionId})`);
          return;
        }

        const stepType = getStepType(stepId);
        if (!stepType) {
          console.warn(`[Port] Cannot determine step type for: ${stepId}`);
          return;
        }

        // Some backends omit providerId for synthesis/mapping partials; derive from stepId if needed
        let pid: string | null | undefined = providerId;
        if ((!pid || typeof pid !== 'string') && (stepType === 'synthesis' || stepType === 'mapping')) {
          pid = extractProviderFromStepId(stepId, stepType);
        }
        if (!pid) {
          console.warn(`[Port] PARTIAL_RESULT missing providerId and could not be derived for step ${stepId}`);
          return;
        }

        // Initialize buffer if needed
        if (!streamingBufferRef.current) {
          streamingBufferRef.current = new StreamingBuffer((updates) => {
            const activeId = activeAiTurnIdRef.current;
            if (!activeId || !updates || updates.length === 0) return;

            setTurnsMap((draft: Map<string, TurnMessage>) => {
              const existing = draft.get(activeId);
              if (!existing || existing.type !== 'ai') return;
              const aiTurn = existing as AiTurn;
              // Apply batched updates using helper
              applyStreamingUpdates(aiTurn, updates);
            });
          });
        }

        streamingBufferRef.current.addDelta(pid, chunk.text, 'streaming', stepType);

        // Store provider context in separate atom
        if (chunk.meta) {
          setProviderContexts((draft: Record<string, any>) => {
            draft[pid as string] = { ...(draft[pid as string] || {}), ...chunk.meta };
          });
        }
        break;
      }

      case 'WORKFLOW_STEP_UPDATE': {
        const { stepId, status, result, error, sessionId: msgSessionId } = message;
        
        if (msgSessionId && currentSessionId && msgSessionId !== currentSessionId) {
          console.warn(`[Port] Ignoring WORKFLOW_STEP_UPDATE from ${msgSessionId}`);
          break;
        }

        if (status === 'completed' && result) {
          streamingBufferRef.current?.flushImmediate();
          
          // ✅ CRITICAL FIX: Properly detect step type and route completions
          const stepType = getStepType(stepId);
          
          if (!stepType) {
            console.error(`[Port] Cannot route completion - unknown stepId: ${stepId}`);
            break;
          }

          // Backend sends either:
          // 1. { results: { claude: {...}, gemini: {...} } } for batch steps
          // 2. { providerId: 'gemini', text: '...', status: '...' } for single-provider steps
          const resultsMap = result.results || (result.providerId ? { [result.providerId]: result } : {});
          
          Object.entries(resultsMap).forEach(([providerId, data]: [string, any]) => {
            const activeId = activeAiTurnIdRef.current;
            if (!activeId) return;

            console.log(`[Port] Completing ${stepType}/${providerId}:`, {
              textLength: data?.text?.length,
              status: data?.status
            });

            setTurnsMap((draft: Map<string, TurnMessage>) => {
              const existing = draft.get(activeId);
              if (!existing || existing.type !== 'ai') {
                console.warn(`[Port] No active AI turn found for completion: ${activeId}`);
                return;
              }
              const aiTurn = existing as AiTurn;
              // Apply completion using helper with correct routing
              applyCompletionUpdate(aiTurn, providerId, data, stepType);
            });
          });
        } else if (status === 'failed') {
          console.error(`[Port] Step failed: ${stepId}`, error);
        }
        break;
      }

      case 'WORKFLOW_COMPLETE': {
        const { sessionId: msgSessionId } = message;
        if (msgSessionId && currentSessionId && msgSessionId !== currentSessionId) {
          console.warn(`[Port] Ignoring WORKFLOW_COMPLETE from ${msgSessionId}`);
          break;
        }

        streamingBufferRef.current?.flushImmediate();
        // Fallback finalization is no longer needed.
        // The robust TURN_FINALIZED handler will manage this state change.
        setIsLoading(false);
        setUiPhase('awaiting_action');
        setIsContinuationMode(true);
        // Do NOT clear activeAiTurnId here; wait for TURN_FINALIZED
        break;
      }
    }
  }, [
    setTurnsMap,
    setTurnIds,
    setCurrentSessionId, 
    currentSessionId,
    setIsLoading,
    setUiPhase,
    setIsContinuationMode,
    setActiveAiTurnId,
    setProviderContexts,
    turnsMap,
    selectedModels,
    mappingEnabled,
    mappingProvider,
    synthesisProvider
  ]);

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