// ui/components/AiTurnBlockConnected.tsx
import React, { useCallback } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import AiTurnBlock from './AiTurnBlock';
import ProviderResponseBlockConnected from './ProviderResponseBlockConnected';

import { 
  isLoadingAtom, 
  currentAppStepAtom, 
  isReducedMotionAtom, 
  showSourceOutputsAtom, 
  activeClipsAtom, 
  activeAiTurnIdAtom, 
  viewModeAtom,
  activeRecomputeStateAtom,
} from '../state/atoms';
import { useClipActions } from '../hooks/useClipActions';
import { useEligibility } from '../hooks/useEligibility';
import type { AiTurn } from '../types';
import { ViewMode } from '../types'; 

interface AiTurnBlockConnectedProps {
  aiTurn: AiTurn;
}

export default function AiTurnBlockConnected({ aiTurn }: AiTurnBlockConnectedProps) {
  const [isLoading] = useAtom(isLoadingAtom);
  const [currentAppStep] = useAtom(currentAppStepAtom);
  const [isReducedMotion] = useAtom(isReducedMotionAtom);
  const [showSourceOutputs, setShowSourceOutputs] = useAtom(showSourceOutputsAtom);
  const [activeClips] = useAtom(activeClipsAtom);
  const [activeAiTurnId] = useAtom(activeAiTurnIdAtom);
  const setViewMode = useSetAtom(viewModeAtom);
  const { handleClipClick } = useClipActions();
  const { eligibilityMaps } = useEligibility();
  const [activeRecomputeState] = useAtom(activeRecomputeStateAtom);

  const isLive = !!activeAiTurnId && activeAiTurnId === aiTurn.id;

  const turnClips = activeClips[aiTurn.id] || {};

  return (
    <AiTurnBlock
      aiTurn={aiTurn}
      isLive={isLive}
      isReducedMotion={isReducedMotion}
      isLoading={isLoading}
      activeRecomputeState={activeRecomputeState}
      currentAppStep={currentAppStep}
      showSourceOutputs={showSourceOutputs}
      onToggleSourceOutputs={useCallback(() => setShowSourceOutputs(prev => !prev), [setShowSourceOutputs])}
      onEnterComposerMode={useCallback(() => setViewMode(ViewMode.COMPOSER), [setViewMode])}
      activeSynthesisClipProviderId={turnClips.synthesis}
      activeMappingClipProviderId={turnClips.mapping}
      onClipClick={useCallback((type: 'synthesis' | 'mapping', pid: string) => {
        void handleClipClick(aiTurn.id, type, pid);
      }, [handleClipClick, aiTurn.id])}
    >
      <ProviderResponseBlockConnected aiTurnId={aiTurn.id} />
    </AiTurnBlock>
  );
}