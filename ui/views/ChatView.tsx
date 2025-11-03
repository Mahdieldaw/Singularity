import React, { useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useAtom } from 'jotai';
import { turnIdsAtom, isLoadingAtom, showWelcomeAtom } from '../state/atoms';

import MessageRow from '../components/MessageRow';
import ChatInputConnected from '../components/ChatInputConnected';
import WelcomeScreen from '../components/WelcomeScreen';
import { useScrollPersistence } from '../hooks/useScrollPersistence';
import CompactModelTrayConnected from '../components/CompactModelTrayConnected';

export default function ChatView() {
  const [turnIds] = useAtom(turnIdsAtom as any) as [string[], any];
  const [isLoading] = useAtom(isLoadingAtom as any) as [boolean, any];
  const [showWelcome] = useAtom(showWelcomeAtom as any) as [boolean, any];
  // Note: Avoid subscribing to uiPhase in ChatView to reduce unnecessary re-renders during streaming

  const scrollerRef = useScrollPersistence();

  const itemContent = useMemo(() => (index: number, turnId: string) => {
    if (!turnId) {
      return <div style={{ padding: '8px', color: '#ef4444' }}>Error: Invalid turn ID</div>;
    }
    return <MessageRow turnId={turnId} />;
  }, []);

  // Memoize Virtuoso Scroller to avoid remounts that can reset scroll position
  type ScrollerProps = Pick<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, 'children' | 'style' | 'tabIndex'>;
  const ScrollerComponent = useMemo(() => (
    React.forwardRef<HTMLDivElement, ScrollerProps>((props, ref) => (
      <div 
        {...props}
        ref={(node) => {
          if (typeof ref === 'function') ref(node as HTMLDivElement | null);
          else if (ref && 'current' in (ref as any)) ((ref as React.MutableRefObject<HTMLDivElement | null>).current = node as HTMLDivElement | null);
          (scrollerRef as React.MutableRefObject<HTMLElement | null>).current = node as HTMLDivElement | null;
        }}
        style={{
          ...(props.style || {}),
          height: '100%',
          minHeight: 0,
          overflowY: 'auto',
          // Remove overscrollBehavior: 'contain' to allow scroll chaining from inner elements
          WebkitOverflowScrolling: 'touch'
        }}
      />
    ))
  ), [scrollerRef]);

  return (
    <div className="chat-view" style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: '100%', 
      width: '100%',
      flex: 1,
      minHeight: 0
    }}>
      {showWelcome ? (
        <WelcomeScreen />
      ) : (
        <Virtuoso
          style={{ flex: 1 }}
          data={turnIds}
          followOutput={(isAtBottom: boolean) => (isAtBottom ? 'smooth' : false)}
          increaseViewportBy={{ top: 800, bottom: 600 }}
          components={{ 
            Scroller: ScrollerComponent as unknown as React.ComponentType<any>
          }}
          itemContent={itemContent}
          computeItemKey={(index, turnId) => turnId || `fallback-${index}`}
        />
      )}

      <ChatInputConnected />
      <CompactModelTrayConnected />  
    </div>
  );
}