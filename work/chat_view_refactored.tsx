// ui/views/ChatView.tsx - ID-BASED RENDERING
import React, { useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useAtom } from 'jotai';
import { 
  turnIdsAtom,  // ✅ NEW: Subscribe to IDs only, not full data
  isLoadingAtom, 
  showWelcomeAtom, 
  uiPhaseAtom 
} from '../state/atoms';

import MessageRow from '../components/MessageRow';
import ChatInputConnected from '../components/ChatInputConnected';
import WelcomeScreen from '../components/WelcomeScreen';
import { useScrollPersistence } from '../hooks/useScrollPersistence';
import CompactModelTrayConnected from '../components/CompactModelTrayConnected';

/**
 * CRITICAL CHANGE: ChatView now subscribes ONLY to turnIdsAtom.
 * 
 * Pattern: "Structural Subscription"
 * 
 * Why this works:
 * - turnIdsAtom only changes when a turn is added/removed, never during streaming
 * - Virtuoso gets a stable array of primitive strings (turnId)
 * - MessageRow components pull their own data via derived atoms
 * - Result: ChatView never re-renders during streaming!
 */
export default function ChatView() {
  const [turnIds] = useAtom(turnIdsAtom);  // ✅ NEW: IDs only
  const [isLoading] = useAtom(isLoadingAtom);
  const [showWelcome] = useAtom(showWelcomeAtom);
  const [uiPhase] = useAtom(uiPhaseAtom);

  const scrollerRef = useScrollPersistence();

  /**
   * Memoized item renderer
   * 
   * CRITICAL: We pass turnId (string) to MessageRow, not the full Turn object.
   * MessageRow will derive the Turn data itself via a selector atom.
   */
  const itemContent = useMemo(() => (index: number, turnId: string) => {
    if (!turnId) {
      return <div style={{ padding: '8px', color: '#ef4444' }}>Error: Invalid turn ID</div>;
    }
    return <MessageRow turnId={turnId} />;
  }, []);

  /**
   * Compute item key from turnId
   * 
   * CRITICAL: Virtuoso needs stable keys. Since turnIds are immutable strings,
   * this provides perfect stability.
   */
  const computeItemKey = useMemo(() => (index: number, turnId: string) => {
    return turnId || `fallback-${index}`;
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
          data={turnIds}  // ✅ NEW: Array of strings, not Turn objects
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
          computeItemKey={computeItemKey}
        />
      )}

      <ChatInputConnected />
      <CompactModelTrayConnected />  
    </div>
  );
}
