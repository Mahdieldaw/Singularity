// ui/components/AiTurnBlockConnected.tsx
import React from 'react';
import { useAtom, useSetAtom } from 'jotai';
import AiTurnBlock from './AiTurnBlock';
import { 
  isLoadingAtom, 
  currentAppStepAtom, 
  isReducedMotionAtom, 
  showSourceOutputsAtom, 
  activeClipsAtom, 
  activeAiTurnIdAtom, 
  viewModeAtom 
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

  const isLive = !!activeAiTurnId && activeAiTurnId === aiTurn.id;

  const turnClips = activeClips[aiTurn.id] || {};

  return (
    <AiTurnBlock
      aiTurn={aiTurn}
      isLive={isLive}
      isReducedMotion={isReducedMotion}
      isLoading={isLoading}
      currentAppStep={currentAppStep}
      showSourceOutputs={showSourceOutputs}
      onToggleSourceOutputs={() => setShowSourceOutputs(prev => !prev)}
      onEnterComposerMode={() => setViewMode(ViewMode.COMPOSER)}
      activeSynthesisClipProviderId={turnClips.synthesis}
      activeMappingClipProviderId={turnClips.mapping}
      onClipClick={(type, pid) => void handleClipClick(aiTurn.id, type, pid)}
    />
  );
}