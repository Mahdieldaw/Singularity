import { useEffect } from 'react';
import { useAtom } from 'jotai';
import api from '../services/extension-api';
import { isHistoryPanelOpenAtom, isHistoryLoadingAtom, historySessionsAtom } from '../state/atoms';

// The hook now accepts the `isInitialized` flag.
export function useHistoryLoader(isInitialized: boolean) {
  const [isHistoryPanelOpen] = useAtom(isHistoryPanelOpenAtom);
  const [, setIsHistoryLoading] = useAtom(isHistoryLoadingAtom);
  const [, setHistorySessions] = useAtom(historySessionsAtom);

  useEffect(() => {
    // Do not run if the panel isn't open OR if the app hasn't been initialized.
    if (!isHistoryPanelOpen || !isInitialized) return;
    
    let cancelled = false;
    const loadHistory = async () => {
      setIsHistoryLoading(true);
      try {
        // This call is now guaranteed to happen AFTER api.setExtensionId() has been called.
        const response = await api.getHistoryList();
        const sessions = response?.sessions || [];
        const formatted = sessions.map((s: any) => ({
          id: s.sessionId,
          sessionId: s.sessionId,
          title: s.title || 'Untitled',
          startTime: s.startTime || Date.now(),
          lastActivity: s.lastActivity || Date.now(),
          messageCount: s.messageCount || 0,
          firstMessage: s.firstMessage || '',
          messages: []
        }));
        if (!cancelled) setHistorySessions(formatted);
      } catch (e) {
        console.error('Failed to load history', e);
      } finally {
        if (!cancelled) setIsHistoryLoading(false);
      }
    };

    loadHistory();
    return () => { cancelled = true; };
  }, [isHistoryPanelOpen, isInitialized, setIsHistoryLoading, setHistorySessions]);
}