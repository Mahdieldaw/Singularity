// ui/hooks/useInitialization.ts - MAP-BASED RESET
import { useState, useEffect } from 'react';
import { useSetAtom } from 'jotai';
import {
  turnsMapAtom,
  turnIdsAtom,
  currentSessionIdAtom,
  selectedModelsAtom,
  isHistoryPanelOpenAtom,
  activeClipsAtom,
} from '../state/atoms';
import api from '../services/extension-api';

/**
 * Initialization hook - sets up clean state on app mount
 * 
 * Pattern: "Bootstrap Layer"
 * 
 * CRITICAL CHANGES:
 * - Clear turnsMap and turnIds instead of messages array
 * - Ensure Map is empty, not just the derived messages atom
 */
export function useInitialization(): boolean {
  const [isInitialized, setIsInitialized] = useState(false);

  // ✅ NEW: Get setters for Map-based state
  const setTurnsMap = useSetAtom(turnsMapAtom);
  const setTurnIds = useSetAtom(turnIdsAtom);
  const setCurrentSessionId = useSetAtom(currentSessionIdAtom);
  const setSelectedModels = useSetAtom(selectedModelsAtom);
  const setIsHistoryPanelOpen = useSetAtom(isHistoryPanelOpenAtom);
  const setActiveClips = useSetAtom(activeClipsAtom);

  useEffect(() => {
    if (isInitialized) return;

    const initialize = async () => {
      // --- Stage 1: Connection Handshake ---
      if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
        api.setExtensionId(chrome.runtime.id);
        console.log('[Init] Extension ID set.');
      } else {
        console.error('[Init] CRITICAL: Could not get chrome.runtime.id. API calls will fail.');
        return; 
      }

      // --- Stage 2: State Reset & Defaulting ---
      // ✅ NEW: Clear Map-based state
      setTurnsMap((draft) => {
        draft.clear();
      });
      setTurnIds((draft) => {
        draft.length = 0;
      });
      
      setCurrentSessionId(null); // Critical: Start with no session
      setActiveClips({});
      
      // Restore last-used selected models if available
      try {
        const raw = localStorage.getItem('htos_selected_models');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            setSelectedModels(parsed);
          }
        }
      } catch (_) {
        // best-effort only
      }
      
      setIsHistoryPanelOpen(false);
      console.log('[Init] UI state has been reset to defaults.');

      // --- Stage 3: Mark Initialization as Complete ---
      setIsInitialized(true);
      console.log('[Init] Initialization complete. Application is ready.');
    };

    initialize();
  }, [
    isInitialized, 
    setTurnsMap, 
    setTurnIds, 
    setCurrentSessionId, 
    setSelectedModels, 
    setIsHistoryPanelOpen, 
    setActiveClips
  ]);

  return isInitialized;
}
