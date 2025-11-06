import React, { useMemo, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { historySessionsAtom, isHistoryLoadingAtom, isHistoryPanelOpenAtom, currentSessionIdAtom } from '../state/atoms';
import { useChat } from '../hooks/useChat';
import HistoryPanel from './HistoryPanel';
import api from '../services/extension-api';

export default function HistoryPanelConnected() {
  const sessions = useAtomValue(historySessionsAtom);
  const isLoading = useAtomValue(isHistoryLoadingAtom);
  const isOpen = useAtomValue(isHistoryPanelOpenAtom);
  const currentSessionId = useAtomValue(currentSessionIdAtom);
  const setHistorySessions = useSetAtom(historySessionsAtom);
  const { newChat, selectChat, deleteChat, deleteChats } = useChat();

  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleDeleteChat = async (sessionId: string) => {
    // Track pending deletion
    setDeletingIds(prev => {
      const next = new Set(prev);
      next.add(sessionId);
      return next;
    });

    // Optimistically remove from panel
    const prevSessions = sessions;
    setHistorySessions((draft: any) => (draft.filter((s: any) => (s.sessionId || s.id) !== sessionId)));

    const ok = await deleteChat(sessionId);

    // Revalidate against backend to prevent flicker-and-revert when SW response is delayed
    try {
      const response = await api.getHistoryList();
      const refreshed = (response?.sessions || []).map((s: any) => ({
        id: s.sessionId,
        sessionId: s.sessionId,
        title: s.title || 'Untitled',
        startTime: s.startTime || Date.now(),
        lastActivity: s.lastActivity || Date.now(),
        messageCount: s.messageCount || 0,
        firstMessage: s.firstMessage || '',
        messages: []
      }));

      setHistorySessions(refreshed as any);

      const stillExists = refreshed.some((s: any) => (s.sessionId || s.id) === sessionId);
      // If the deleted session is gone and was active, clear the chat view immediately
      if (!stillExists && currentSessionId === sessionId) {
        newChat();
      }
    } catch (e) {
      console.error('[HistoryPanel] Failed to refresh history after deletion:', e);
      if (!ok) {
        // If the delete call failed and we also failed to refresh, revert UI to previous list
        setHistorySessions(prevSessions as any);
      }
    }

    // Clear pending state
    setDeletingIds(prev => {
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
  };

  const handleToggleBatchMode = () => {
    setIsBatchMode((prev) => !prev);
    setSelectedIds(new Set());
  };

  const handleToggleSelected = (sessionId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId); else next.add(sessionId);
      return next;
    });
  };

  const handleConfirmBatchDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      // If nothing selected, just exit batch mode
      setIsBatchMode(false);
      return;
    }

    // Optimistically remove selected sessions
    const prevSessions = sessions;
    setHistorySessions((draft: any) => (draft.filter((s: any) => !ids.includes(s.sessionId || s.id))));

    try {
      const { removed } = await deleteChats(ids);
      // Revalidate list with backend
      const response = await api.getHistoryList();
      const refreshed = (response?.sessions || []).map((s: any) => ({
        id: s.sessionId,
        sessionId: s.sessionId,
        title: s.title || 'Untitled',
        startTime: s.startTime || Date.now(),
        lastActivity: s.lastActivity || Date.now(),
        messageCount: s.messageCount || 0,
        firstMessage: s.firstMessage || '',
        messages: []
      }));
      setHistorySessions(refreshed as any);
    } catch (e) {
      console.error('[HistoryPanel] Batch delete failed:', e);
      // revert UI list on failure
      setHistorySessions(prevSessions as any);
    } finally {
      setIsBatchMode(false);
      setSelectedIds(new Set());
    }
  };

  return (
    <HistoryPanel
      isOpen={isOpen}
      sessions={sessions}
      isLoading={isLoading}
      onNewChat={newChat}
      onSelectChat={selectChat}
      onDeleteChat={handleDeleteChat}
      deletingIds={deletingIds}
      isBatchMode={isBatchMode}
      selectedIds={selectedIds}
      onToggleBatchMode={handleToggleBatchMode}
      onToggleSessionSelected={handleToggleSelected}
      onConfirmBatchDelete={handleConfirmBatchDelete}
    />
  );
}
