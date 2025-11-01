// ui/hooks/useInitialization.ts
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
import { LLM_PROVIDERS_CONFIG } from '../constants';

// This hook now returns a single boolean: `isInitialized`
export function useInitialization(): boolean {
  const [isInitialized, setIsInitialized] = useState(false);

  // Get setters for all atoms that need to be reset
  const setTurnsMap = useSetAtom(turnsMapAtom);
  const setTurnIds = useSetAtom(turnIdsAtom);
  const setCurrentSessionId = useSetAtom(currentSessionIdAtom);
  const setSelectedModels = useSetAtom(selectedModelsAtom);
  const setIsHistoryPanelOpen = useSetAtom(isHistoryPanelOpenAtom);
  const setActiveClips = useSetAtom(activeClipsAtom);

  useEffect(() => {
    // Prevent this from running more than once
    if (isInitialized) return;

    const initialize = async () => {
      // --- Stage 1: Connection Handshake (from your old API init hook) ---
      // This MUST happen first.
      if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
        api.setExtensionId(chrome.runtime.id);
        console.log('[Init] Extension ID set.');
      } else {
        console.error('[Init] CRITICAL: Could not get chrome.runtime.id. API calls will fail.');
        // In a real app, you might want to show a permanent error screen here.
        return; 
      }

      // --- Stage 2: State Reset & Defaulting ---
      // Clear Map-based chat state to ensure a clean start
      setTurnsMap((draft) => { draft.clear(); });
      setTurnIds((draft) => { draft.length = 0; });
      setCurrentSessionId(null); // Critical: Start with no session
      
      setActiveClips({});
      
      // Restore last-used selected models if available; otherwise respect atom default
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
      // This unblocks the rest of the application.
      setIsInitialized(true);
      console.log('[Init] Initialization complete. Application is ready.');
    };

    initialize();
  }, [isInitialized, setTurnsMap, setTurnIds, setCurrentSessionId, setSelectedModels, setIsHistoryPanelOpen, setActiveClips]);

  return isInitialized;
}
