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

// 1. Module-level flag → survives React StrictMode double-mount
let hasModuleInitialized = false;

export function useInitialization(): boolean {
  const [isInitialized, setIsInitialized] = useState(false);

  // Setters for all atoms we need to reset
  const setTurnsMap           = useSetAtom(turnsMapAtom);
  const setTurnIds            = useSetAtom(turnIdsAtom);
  const setCurrentSessionId   = useSetAtom(currentSessionIdAtom);
  const setSelectedModels     = useSetAtom(selectedModelsAtom);
  const setIsHistoryPanelOpen = useSetAtom(isHistoryPanelOpenAtom);
  const setActiveClips        = useSetAtom(activeClipsAtom);

  useEffect(() => {
    if (hasModuleInitialized) return;          // already done
    hasModuleInitialized = true;               // reserve slot immediately

    const initialize = async () => {
      // --- Stage 1: Connection handshake ---
      if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
        api.setExtensionId(chrome.runtime.id);
        console.log('[Init] Extension ID set.');
      } else {
        throw new Error('CRITICAL: chrome.runtime.id unavailable – API calls will fail.');
      }

      // --- Stage 2: Reset all UI state ---
      setTurnsMap(draft => draft.clear());
      setTurnIds(draft => { draft.length = 0; });
      setCurrentSessionId(null);
      setActiveClips({});

      // --- Stage 3: Restore user preferences (best-effort) ---
      try {
        const raw = localStorage.getItem('htos_selected_models');
        if (raw) setSelectedModels(JSON.parse(raw));
      } catch { /* ignore */ }

      setIsHistoryPanelOpen(false);
      console.log('[Init] UI state reset to defaults.');
    };

    // --- Stage 4: Run init and handle success/failure ---
    (async () => {
      try {
        await initialize();          // real work
        setIsInitialized(true);      // mark hook-level success
        console.log('[Init] Initialization complete. Application is ready.');
      } catch (err) {
        console.error('[Init] Initialization failed:', err);
        hasModuleInitialized = false; // allow retry on next mount
      }
    })();
  }, [
    setTurnsMap,
    setTurnIds,
    setCurrentSessionId,
    setSelectedModels,
    setIsHistoryPanelOpen,
    setActiveClips,
  ]);

  return isInitialized;
}