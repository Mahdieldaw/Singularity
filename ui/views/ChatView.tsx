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

  // ✅ FIX: Filter out null/undefined messages
  const validMessages = useMemo(() => {
    if (!messages || !Array.isArray(messages)) {
      console.warn('[ChatView] Invalid messages array:', messages);
      return [];
    }
    return messages.filter(m => {
      if (!m || !m.id) {
        console.warn('[ChatView] Filtering out invalid message:', m);
        return false;
      }
      return true;
    });
  }, [messages]);

  const itemContent = useMemo(() => (index: number, message: any) => {
    // ✅ FIX: Additional null check
    if (!message) {
      console.error('[ChatView] Null message at index:', index);
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
      overflow: 'hidden'
    }}>
      {/* Main content area - shows either welcome or messages */}
      <div style={{ 
        flex: 1, 
        overflow: 'hidden', 
        display: 'flex', 
        flexDirection: 'column' 
      }}>
        {showWelcome ? (
          <WelcomeScreen />
        ) : (
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <Virtuoso
              data={validMessages}
              // follow only when the user is already at the bottom; prevents forcing scroll when user is reading older turns
              followOutput="auto"
              // render extra content above/below viewport to reduce reflows/jumps during streaming/height changes
              increaseViewportBy={{ top: 800, bottom: 600 }}
               components={{ 
                 Scroller: React.forwardRef((props: any, ref: any) => (
                   <div 
                     {...props} 
                     ref={(node) => {
                       // Combine refs
                       if (typeof ref === 'function') {
                         ref(node);
                       } else if (ref) {
                         ref.current = node;
                       }
                       scrollerRef.current = node;
                     }} 
                   />
                 ))
               }}
              itemContent={itemContent}
              computeItemKey={(index, message) => {
                // ✅ FIX: Safe key computation
                return message?.id || `fallback-${index}`;
              }}
            />
          </div>
        )}
      </div>
      
      {/* ChatInput - always visible at bottom */}
      <ChatInputConnected />
    </div>
  );
}