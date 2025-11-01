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

function ProviderResponseBlockConnected({ aiTurnId }: { aiTurnId: string }) {
  // Isolated selector subscription
  const providerResponsesGetter = useAtomValue(providerResponsesForTurnAtom);
  const providerResponses = React.useMemo(
    () => providerResponsesGetter(aiTurnId),
    [providerResponsesGetter, aiTurnId]
  );

  // Global UI state
  const isLoading = useAtomValue(isLoadingAtom);
  const currentAppStep = useAtomValue(currentAppStepAtom);
  const isReducedMotion = useAtomValue(isReducedMotionAtom);

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

export default React.memo(ProviderResponseBlockConnected);
