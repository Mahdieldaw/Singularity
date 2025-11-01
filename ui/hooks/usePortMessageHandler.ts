// ui/hooks/usePortMessageHandler.ts - ALIGNED VERSION
import { useCallback, useRef, useEffect } from 'react';
import { useSetAtom, useAtomValue } from 'jotai';
import { 
  turnsMapAtom,
  currentSessionIdAtom, 
  pendingUserTurnsAtom,
  isLoadingAtom,
  uiPhaseAtom,
  activeAiTurnIdAtom,
  isContinuationModeAtom,
  providerContextsAtom
} from '../state/atoms';
import { StreamingBuffer } from '../utils/streamingBuffer';
import { applyStreamingUpdates, applyCompletionUpdate } from '../utils/turn-helpers';
import api from '../services/extension-api';
import type { TurnMessage, UserTurn, AiTurn } from '../types';

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
  const setCurrentSessionId = useSetAtom(currentSessionIdAtom);
  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const setPendingUserTurns = useSetAtom(pendingUserTurnsAtom);
  const setIsLoading = useSetAtom(isLoadingAtom);
  const setUiPhase = useSetAtom(uiPhaseAtom);
  const setIsContinuationMode = useSetAtom(isContinuationModeAtom);
  const activeAiTurnId = useAtomValue(activeAiTurnIdAtom);
  const setActiveAiTurnId = useSetAtom(activeAiTurnIdAtom);
  const setProviderContexts = useSetAtom(providerContextsAtom);
  
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
      case 'SESSION_STARTED': {
        const newSessionId = message.sessionId;
        setCurrentSessionId(newSessionId);
        
        // Backfill session ID in turns map
        setTurnsMap((draft: Map<string, TurnMessage>) => {
          draft.forEach((m: TurnMessage, key: string) => {
            if (!m.sessionId) {
              draft.set(key, { ...m, sessionId: newSessionId } as TurnMessage);
            }
          });
        });
        
        // Backfill session ID in pending user turns
        setPendingUserTurns((draft: Map<string, UserTurn>) => {
          draft.forEach((userTurn: UserTurn, aiId: string) => {
            if (!userTurn.sessionId) {
              draft.set(aiId, { ...userTurn, sessionId: newSessionId });
            }
          });
        });
        
        try { api.setSessionId(newSessionId); } catch {}
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
        const completedTurnId = activeAiTurnIdRef.current;

        setIsLoading(false);
        setUiPhase('awaiting_action');
        setIsContinuationMode(true);
        setActiveAiTurnId(null);

        // Cleanup pending user turns
        if (completedTurnId) {
          setPendingUserTurns((draft: Map<string, UserTurn>) => {
            draft.delete(completedTurnId);
          });
        }
        break;
      }
    }
  }, [
    setTurnsMap, 
    setCurrentSessionId, 
    currentSessionId,
    setPendingUserTurns,
    setIsLoading,
    setUiPhase,
    setIsContinuationMode,
    setActiveAiTurnId,
    setProviderContexts
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