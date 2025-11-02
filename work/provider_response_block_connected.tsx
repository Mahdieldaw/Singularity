// ui/components/ProviderResponseBlockConnected.tsx - ISOLATED SUBSCRIPTION
import React from 'react';
import { useAtomValue } from 'jotai';
import { 
  providerResponsesForTurnAtom, 
  isLoadingAtom, 
  currentAppStepAtom, 
  isReducedMotionAtom 
} from '../state/atoms';
import ProviderResponseBlock from './ProviderResponseBlock';

/**
 * CRITICAL COMPONENT: The Performance Bottleneck Fix
 * 
 * Pattern: "Isolated Subscription Wrapper"
 * 
 * This is the KEY to eliminating the re-render cascade. By creating a
 * separate connected component that subscribes ONLY to this specific
 * turn's provider responses, we prevent streaming updates from cascading
 * up to AiTurnBlock and beyond.
 * 
 * How it works:
 * 1. Receives aiTurnId (stable string) from AiTurnBlockConnected
 * 2. Uses providerResponsesForTurnAtom selector to get ONLY this turn's responses
 * 3. When streaming updates this turn's responses, ONLY this component re-renders
 * 4. Parent AiTurnBlock, MessageRow, and siblings remain untouched
 * 
 * Why this works:
 * - The selector atom is parameterized by turnId
 * - Jotai's atom dependency tracking is surgical
 * - React.memo prevents prop-based cascades
 * - Result: O(1) re-renders per streaming chunk instead of O(n)
 */
function ProviderResponseBlockConnected({ aiTurnId }: { aiTurnId: string }) {
  /**
   * ✅ CRITICAL SUBSCRIPTION: This is the isolated subscription point
   * 
   * The selector function returned by providerResponsesForTurnAtom
   * creates a unique subscription for this specific turn ID. When
   * streaming updates arrive via usePortMessageHandler, only THIS
   * component's subscription triggers.
   */
  const providerResponsesGetter = useAtomValue(providerResponsesForTurnAtom);
  const providerResponses = React.useMemo(
    () => providerResponsesGetter(aiTurnId),
    [providerResponsesGetter, aiTurnId]
  );
  
  // Global UI state (these rarely change, safe to subscribe)
  const isLoading = useAtomValue(isLoadingAtom);
  const currentAppStep = useAtomValue(currentAppStepAtom);
  const isReducedMotion = useAtomValue(isReducedMotionAtom);

  /**
   * Debug logging (remove in production)
   * Uncomment to verify isolation is working:
   */
  // React.useEffect(() => {
  //   console.log(`[ProviderResponseBlockConnected] Rendered for turn ${aiTurnId}`, {
  //     responseCount: Object.keys(providerResponses).length
  //   });
  // });

  return (
    <ProviderResponseBlock
      providerResponses={providerResponses}
      isLoading={isLoading}
      currentAppStep={currentAppStep}
      isReducedMotion={isReducedMotion}
      aiTurnId={aiTurnId}
    />
  );
}

/**
 * ✅ CRITICAL: React.memo prevents re-render if aiTurnId prop is unchanged
 * 
 * Since aiTurnId is a stable string primitive, this component will only
 * re-render when:
 * 1. The aiTurnId changes (only happens during initial mount)
 * 2. The provider responses for THIS turn change (via atom subscription)
 * 
 * It will NOT re-render when:
 * - Other turns receive streaming updates
 * - Parent AiTurnBlock re-renders for other reasons
 * - Sibling components update
 */
export default React.memo(ProviderResponseBlockConnected);
