import React from 'react';
import { useAtomValue } from 'jotai';
import { historySessionsAtom, isHistoryLoadingAtom, isHistoryPanelOpenAtom } from '../state/atoms';
import { useChat } from '../hooks/useChat';
import HistoryPanel from './HistoryPanel';

export default function HistoryPanelConnected() {
  const sessions = useAtomValue(historySessionsAtom);
  const isLoading = useAtomValue(isHistoryLoadingAtom);
  const isOpen = useAtomValue(isHistoryPanelOpenAtom);
  const { newChat, selectChat, deleteChat } = useChat();

  return (
    <HistoryPanel
      isOpen={isOpen}
      sessions={sessions}
      isLoading={isLoading}
      onNewChat={newChat}
      onSelectChat={selectChat}
      onDeleteChat={deleteChat}
    />
  );
}
