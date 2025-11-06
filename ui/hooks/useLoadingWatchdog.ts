import { useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { isLoadingAtom, uiPhaseAtom, activeAiTurnIdAtom, alertTextAtom, lastActivityAtAtom } from '../state/atoms';

const LOADING_TIMEOUT_MS = 45000; // 45 seconds

export function useLoadingWatchdog() {
  const isLoading = useAtomValue(isLoadingAtom);
  const lastActivityAt = useAtomValue(lastActivityAtAtom);
  const setIsLoading = useSetAtom(isLoadingAtom);
  const setUiPhase = useSetAtom(uiPhaseAtom);
  const setActiveAiTurnId = useSetAtom(activeAiTurnIdAtom);
  const setAlertText = useSetAtom(alertTextAtom);

  useEffect(() => {
    let timeout: any;
    if (isLoading) {
      const now = Date.now();
      const baseline = lastActivityAt && lastActivityAt > 0 ? lastActivityAt : now;
      const remaining = Math.max(LOADING_TIMEOUT_MS - (now - baseline), 1000);
      timeout = setTimeout(() => {
        const elapsed = Date.now() - (lastActivityAt || baseline);
        if (isLoading && elapsed >= LOADING_TIMEOUT_MS) {
          setIsLoading(false);
          setUiPhase('awaiting_action');
          setActiveAiTurnId(null);
          setAlertText('Processing stalled or timed out. Please try again.');
        }
      }, remaining);
    }
    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [isLoading, lastActivityAt, setIsLoading, setUiPhase, setActiveAiTurnId, setAlertText]);
}