import React, { useMemo, useEffect, useRef } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { useAtom } from "jotai";
import {
  turnIdsAtom,
  isLoadingAtom,
  showWelcomeAtom,
  currentSessionIdAtom,
} from "../state/atoms";

import MessageRow from "../components/MessageRow";
import ChatInputConnected from "../components/ChatInputConnected";
import WelcomeScreen from "../components/WelcomeScreen";
import { useScrollPersistence } from "../hooks/useScrollPersistence";
import CompactModelTrayConnected from "../components/CompactModelTrayConnected";
import { useChat } from "../hooks/useChat";
import RefinerOverlay from "../components/RefinerOverlay";

export default function ChatView() {
  const [turnIds] = useAtom(turnIdsAtom as any) as [string[], any];
  const [isLoading] = useAtom(isLoadingAtom as any) as [boolean, any];
  const [showWelcome] = useAtom(showWelcomeAtom as any) as [boolean, any];
  const [currentSessionId] = useAtom(currentSessionIdAtom as any) as [
    string | null,
    any,
  ];
  // Note: Avoid subscribing to uiPhase in ChatView to reduce unnecessary re-renders during streaming

  const scrollerRef = useScrollPersistence();
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const { selectChat } = useChat();

  const itemContent = useMemo(
    () => (index: number, turnId: string) => {
      if (!turnId) {
        return (
          <div style={{ padding: "8px", color: "#ef4444" }}>
            Error: Invalid turn ID
          </div>
        );
      }
      return <MessageRow turnId={turnId} />;
    },
    [],
  );

  // Memoize Virtuoso Scroller to avoid remounts that can reset scroll position
  type ScrollerProps = Pick<
    React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLDivElement>,
      HTMLDivElement
    >,
    "children" | "style" | "tabIndex"
  >;
  const ScrollerComponent = useMemo(
    () =>
      React.forwardRef<HTMLDivElement, ScrollerProps>((props, ref) => (
        <div
          {...props}
          ref={(node) => {
            if (typeof ref === "function") ref(node as HTMLDivElement | null);
            else if (ref && "current" in (ref as any))
              (ref as React.MutableRefObject<HTMLDivElement | null>).current =
                node as HTMLDivElement | null;
            (
              scrollerRef as React.MutableRefObject<HTMLElement | null>
            ).current = node as HTMLDivElement | null;
          }}
          style={{
            ...(props.style || {}),
            height: "100%",
            minHeight: 0,
            overflowY: "auto",
            // Remove overscrollBehavior: 'contain' to allow scroll chaining from inner elements
            WebkitOverflowScrolling: "touch",
          }}
        />
      )),
    [scrollerRef],
  );

  // Jump-to-turn event listener with optional cross-session loading
  useEffect(() => {
    const handler = async (evt: Event) => {
      try {
        const detail = (evt as CustomEvent<any>).detail || {};
        const targetTurnId: string | undefined =
          detail.turnId || detail.aiTurnId || detail.userTurnId;
        const targetProviderId: string | undefined = detail.providerId;
        const targetSessionId: string | undefined = detail.sessionId;
        if (!targetTurnId) return;

        const doScroll = () => {
          try {
            const index = turnIds.findIndex((id) => id === targetTurnId);
            if (index !== -1) {
              virtuosoRef.current?.scrollToIndex({
                index,
                behavior: "smooth",
                align: "center",
              });
            } else {
              // Fallback to DOM query when item is rendered
              const el = document.querySelector(
                `[data-turn-id="${CSS.escape(targetTurnId)}"]`,
              ) as HTMLElement | null;
              if (el && typeof el.scrollIntoView === "function") {
                el.scrollIntoView({ behavior: "smooth", block: "center" });
              }
            }
            // Brief highlight pulse
            const row =
              document.getElementById(`turn-${targetTurnId}`) ||
              document.querySelector(
                `[data-turn-id="${CSS.escape(targetTurnId)}"]`,
              );
            if (row && row instanceof HTMLElement) {
              const prev = row.style.boxShadow;
              row.style.boxShadow = "0 0 0 2px rgba(99,102,241,0.55)";
              setTimeout(() => {
                row.style.boxShadow = prev;
              }, 1200);
            }
            // Focus provider card if requested
            if (targetProviderId) {
              setTimeout(() => {
                document.dispatchEvent(
                  new CustomEvent("htos:scrollToProvider", {
                    detail: {
                      aiTurnId: targetTurnId,
                      providerId: targetProviderId,
                    },
                  }),
                );
              }, 120);
            }
          } catch (e) {
            console.warn("[ChatView] doScroll failed", e);
          }
        };

        // Cross-session navigation support
        if (
          targetSessionId &&
          currentSessionId &&
          targetSessionId !== currentSessionId
        ) {
          const summary = {
            id: targetSessionId,
            sessionId: targetSessionId,
            startTime: Date.now(),
            lastActivity: Date.now(),
            title: "",
            firstMessage: "",
            messageCount: 0,
            messages: [],
          };
          await selectChat(summary as any);
          // Wait a tick for state to settle then scroll
          requestAnimationFrame(() => doScroll());
        } else {
          doScroll();
        }
      } catch (e) {
        console.warn("[ChatView] jump-to-turn handler failed", e);
      }
    };
    document.addEventListener("jump-to-turn", handler as EventListener);
    return () =>
      document.removeEventListener("jump-to-turn", handler as EventListener);
  }, [turnIds, currentSessionId, selectChat]);

  return (
    <div
      className="chat-view"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        flex: 1,
        minHeight: 0,
      }}
    >
      <RefinerOverlay />
      {showWelcome ? (
        <WelcomeScreen />
      ) : (
        <Virtuoso
          style={{ flex: 1 }}
          data={turnIds}
          followOutput={(isAtBottom: boolean) =>
            isAtBottom ? "smooth" : false
          }
          increaseViewportBy={{ top: 300, bottom: 200 }}
          components={{
            Scroller: ScrollerComponent as unknown as React.ComponentType<any>,
          }}
          itemContent={itemContent}
          computeItemKey={(index, turnId) => turnId || `fallback-${index}`}
          ref={virtuosoRef as any}
        />
      )}
      <ChatInputConnected />
      <CompactModelTrayConnected />
    </div>
  );
}
