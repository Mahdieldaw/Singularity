import React, { useCallback } from 'react';
import { useAtom } from 'jotai';
import { useChat } from '../hooks/useChat';
import { isLoadingAtom, isContinuationModeAtom, activeProviderCountAtom, isVisibleModeAtom, isReducedMotionAtom } from '../state/atoms';
import ChatInput from './ChatInput';

const ChatInputConnected = () => {
  const [isLoading] = useAtom(isLoadingAtom as any) as [boolean, any];
  const [isContinuationMode] = useAtom(isContinuationModeAtom as any) as [boolean, any];
  const [activeProviderCount] = useAtom(activeProviderCountAtom as any) as [number, any];
  const [isVisibleMode] = useAtom(isVisibleModeAtom as any) as [boolean, any];
  const [isReducedMotion] = useAtom(isReducedMotionAtom as any) as [boolean, any];
  const { sendMessage } = useChat();

  const handleSend = useCallback((prompt: string) => {
    void sendMessage(prompt, 'new');
  }, [sendMessage]);

  const handleCont = useCallback((prompt: string) => {
    void sendMessage(prompt, 'continuation');
  }, [sendMessage]);

  return (
    <ChatInput
      onSendPrompt={handleSend}
      onContinuation={handleCont}
      isLoading={isLoading}
      isReducedMotion={isReducedMotion}
      activeProviderCount={activeProviderCount}
      isVisibleMode={isVisibleMode}
      isContinuationMode={isContinuationMode}
    />
  );
};

export default ChatInputConnected;
