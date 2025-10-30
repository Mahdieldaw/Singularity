// ui/hooks/useInitialization.ts
import { useState, useEffect } from 'react';
import { useSetAtom } from 'jotai';
import {
  messagesAtom,
  currentSessionIdAtom,
  selectedModelsAtom,
  isHistoryPanelOpenAtom,
  // Add any other atoms that need resetting
} from '../state/atoms';
import api from '../services/extension-api';
import { LLM_PROVIDERS_CONFIG } from '../constants';

// This hook now returns a single boolean: `isInitialized`
export function useInitialization(): boolean {
  const [isInitialized, setIsInitialized] = useState(false);

  // Get setters for all atoms that need to be reset
  const setMessages = useSetAtom(messagesAtom);
  const setCurrentSessionId = useSetAtom(currentSessionIdAtom);
  const setSelectedModels = useSetAtom(selectedModelsAtom);
  const setIsHistoryPanelOpen = useSetAtom(isHistoryPanelOpenAtom);

  
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

      // --- Stage 2: State Reset & Defaulting (from your old bootstrap hook) ---
      // This ensures the UI starts in a clean, predictable state.
      const defaultModels = LLM_PROVIDERS_CONFIG.reduce<Record<string, boolean>>((acc, p) => {
        acc[p.id] = ['claude', 'gemini', 'chatgpt'].includes(p.id);
        return acc;
      }, {});
      
      setMessages([]);
      setCurrentSessionId(null); // Critical: Start with no session
      setSelectedModels(defaultModels);
      setIsHistoryPanelOpen(false);
      console.log('[Init] UI state has been reset to defaults.');

      // --- Stage 3: Mark Initialization as Complete ---
      // This unblocks the rest of the application.
      setIsInitialized(true);
      console.log('[Init] Initialization complete. Application is ready.');
    };

    initialize();
  }, [isInitialized, setMessages, setCurrentSessionId, setSelectedModels, setIsHistoryPanelOpen]);

  return isInitialized;
}