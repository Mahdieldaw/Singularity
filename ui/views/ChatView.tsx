import React, { useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useAtom } from 'jotai';
import { turnIdsAtom, isLoadingAtom, showWelcomeAtom, uiPhaseAtom } from '../state/atoms';

import MessageRow from '../components/MessageRow';
import ChatInputConnected from '../components/ChatInputConnected';
import WelcomeScreen from '../components/WelcomeScreen';
import { useScrollPersistence } from '../hooks/useScrollPersistence';
import CompactModelTrayConnected from '../components/CompactModelTrayConnected';

export default function ChatView() {
  const [turnIds] = useAtom(turnIdsAtom as any) as [string[], any];
  const [isLoading] = useAtom(isLoadingAtom as any) as [boolean, any];
  const [showWelcome] = useAtom(showWelcomeAtom as any) as [boolean, any];
  const [uiPhase] = useAtom(uiPhaseAtom as any) as ['idle' | 'streaming' | 'awaiting_action', any];

  const scrollerRef = useScrollPersistence();

  const itemContent = useMemo(() => (index: number, turnId: string) => {
    if (!turnId) {
      return <div style={{ padding: '8px', color: '#ef4444' }}>Error: Invalid turn ID</div>;
    }
    return <MessageRow turnId={turnId} />;
  }, []);

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
            Scroller: React.forwardRef((props: any, ref: any) => (
              <div 
                {...props} 
                ref={(node) => {
                  if (typeof ref === 'function') ref(node);
                  else if (ref) (ref as any).current = node;
                  (scrollerRef as any).current = node;
                }}
                style={{
                  ...(props.style || {}),
                  height: '100%',
                  minHeight: 0,
                  overflowY: 'auto',
                  overscrollBehavior: 'contain',
                  WebkitOverflowScrolling: 'touch'
                }}
              />
            ))
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