import React, { useMemo, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { historySessionsAtom, isHistoryLoadingAtom, isHistoryPanelOpenAtom } from '../state/atoms';
import { useChat } from '../hooks/useChat';
import HistoryPanel from './HistoryPanel';

export default function HistoryPanelConnected() {
  const sessions = useAtomValue(historySessionsAtom);
  const isLoading = useAtomValue(isHistoryLoadingAtom);
  const isOpen = useAtomValue(isHistoryPanelOpenAtom);
  const setHistorySessions = useSetAtom(historySessionsAtom);
  const { newChat, selectChat, deleteChat } = useChat();

  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

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

    if (!ok) {
      // Roll back if deletion failed
      setHistorySessions(prevSessions as any);
    }

    // Clear pending state
    setDeletingIds(prev => {
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
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
    />
  );
}
