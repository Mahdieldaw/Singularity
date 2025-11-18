import React, { useCallback } from "react";
import { useAtom } from "jotai";
import { useChat } from "../hooks/useChat";
import {
  isLoadingAtom,
  isRefiningAtom,
  isContinuationModeAtom,
  activeProviderCountAtom,
  isVisibleModeAtom,
  isReducedMotionAtom,
  chatInputHeightAtom, // ← ADD THIS
} from "../state/atoms";
import ChatInput from "./ChatInput";

const ChatInputConnected = () => {
  const [isLoading] = useAtom(isLoadingAtom as any) as [boolean, any];
  const [isRefining] = useAtom(isRefiningAtom as any) as [boolean, any];
  const [isContinuationMode] = useAtom(isContinuationModeAtom as any) as [
    boolean,
    any,
  ];
  const [activeProviderCount] = useAtom(activeProviderCountAtom as any) as [
    number,
    any,
  ];
  const [isVisibleMode] = useAtom(isVisibleModeAtom as any) as [boolean, any];
  const [isReducedMotion] = useAtom(isReducedMotionAtom as any) as [
    boolean,
    any,
  ];
  const [, setChatInputHeight] = useAtom(chatInputHeightAtom); // ← ADD THIS
  const { sendMessage, abort, refinePrompt } = useChat();

  const handleSend = useCallback(
    (prompt: string) => {
      void sendMessage(prompt, "new");
    },
    [sendMessage],
  );

  const handleCont = useCallback(
    (prompt: string) => {
      void sendMessage(prompt, "continuation");
    },
    [sendMessage],
  );

  const handleAbort = useCallback(() => {
    void abort();
  }, [abort]);

  const handleRefine = useCallback(
    (prompt: string) => {
      void refinePrompt(prompt);
    },
    [refinePrompt],
  );

  return (
    <ChatInput
      onSendPrompt={handleSend}
      onContinuation={handleCont}
      onRefinePrompt={handleRefine}
      onAbort={handleAbort}
      isLoading={isLoading}
      isRefining={isRefining}
      isReducedMotion={isReducedMotion}
      activeProviderCount={activeProviderCount}
      isVisibleMode={isVisibleMode}
      isContinuationMode={isContinuationMode}
      onHeightChange={setChatInputHeight} // ← ADD THIS
    />
  );
};

export default ChatInputConnected;
