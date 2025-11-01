import React, { useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useAtom } from 'jotai';
import { messagesAtom, isLoadingAtom, showWelcomeAtom } from '../state/atoms';
import MessageRow from '../components/MessageRow';
import ChatInputConnected from '../components/ChatInputConnected';
import WelcomeScreen from '../components/WelcomeScreen';
import { useScrollPersistence } from '../hooks/useScrollPersistence';

export default function ChatView() {
  const [messages] = useAtom(messagesAtom as any) as [any[], any];
  const [isLoading] = useAtom(isLoadingAtom as any) as [boolean, any];
  const [showWelcome] = useAtom(showWelcomeAtom as any) as [boolean, any];
  
  const scrollerRef = useScrollPersistence();

  const validMessages = useMemo(() => {
    if (!messages || !Array.isArray(messages)) return [];
    return messages.filter(m => m && m.id);
  }, [messages]);

  const itemContent = useMemo(() => (index: number, message: any) => {
    if (!message) {
      return <div style={{ padding: '8px', color: '#ef4444' }}>Error: Invalid message</div>;
    }
    return <MessageRow message={message} />;
  }, []);

  return (
    <div className="chat-view" style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: '100%', 
      width: '100%',
      flex: 1,
      overflow: 'hidden',
      minHeight: 0
    }}>
      <div style={{ 
        flex: 1, 
        overflow: 'hidden', 
        display: 'flex', 
        flexDirection: 'column',
        minHeight: 0
      }}>
        {showWelcome ? (
          <WelcomeScreen />
        ) : (
          <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
            <Virtuoso
              data={validMessages}
              followOutput="auto"
              increaseViewportBy={{ top: 800, bottom: 600 }}
              components={{ 
                Scroller: React.forwardRef((props: any, ref: any) => (
                  <div 
                    {...props} 
                    ref={(node) => {
                      if (typeof ref === 'function') ref(node);
                      else if (ref) ref.current = node;
                      scrollerRef.current = node;
                    }}
                    className="chat-virtuoso-scroller"
                    style={{ 
                      ...props.style,
                      height: '100%', 
                      minHeight: 0,
                      overflowY: 'auto',
                      boxSizing: 'border-box'
                    }}
                  />
                ))
              }}
              itemContent={itemContent}
              computeItemKey={(index, message) => message?.id || `fallback-${index}`}
            />
          </div>
        )}
      </div>
      
      <div style={{ borderTop: '1px solid #1f2937', flex: '0 0 auto' }}>
        <ChatInputConnected />
      </div>
    </div>
  );
}