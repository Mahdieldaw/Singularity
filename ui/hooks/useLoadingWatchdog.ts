import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  isLoadingAtom,
  uiPhaseAtom,
  activeAiTurnIdAtom,
  alertTextAtom,
  lastActivityAtAtom,
  connectionStatusAtom,
} from "../state/atoms";

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
      const baseline =
        lastActivityAt && lastActivityAt > 0 ? lastActivityAt : now;
      const remaining = Math.max(LOADING_TIMEOUT_MS - (now - baseline), 1000);
      timeout = setTimeout(() => {
        const elapsed = Date.now() - (lastActivityAt || baseline);
        if (isLoading && elapsed >= LOADING_TIMEOUT_MS) {
          setIsLoading(false);
          setUiPhase("awaiting_action");
          setActiveAiTurnId(null);
          setAlertText("Processing stalled or timed out. Please try again.");
        }
      }, remaining);
    }
    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [
    isLoading,
    lastActivityAt,
    setIsLoading,
    setUiPhase,
    setActiveAiTurnId,
    setAlertText,
  ]);
}

/**
 * useResponsiveLoadingGuard
 * Non-destructive guard that observes loading and activity and surfaces alerts
 * rather than resetting state. Intended to replace useLoadingWatchdog.
 */
export function useResponsiveLoadingGuard(options?: {
  idleWarnMs?: number;
  idleCriticalMs?: number;
}) {
  const idleWarnMs = options?.idleWarnMs ?? 15_000;
  const idleCriticalMs = options?.idleCriticalMs ?? 45_000;

  const isLoading = useAtomValue(isLoadingAtom);
  const lastActivityAt = useAtomValue(lastActivityAtAtom);
  const connection = useAtomValue(connectionStatusAtom);
  const setAlertText = useSetAtom(alertTextAtom);
  const alertText = useAtomValue(alertTextAtom);

  useEffect(() => {
    // Guard only when connected and currently loading
    if (!isLoading || !connection?.isConnected) {
      if (alertText) setAlertText(null);
      return;
    }

    let warned = false;
    let escalated = false;
    const baseline =
      lastActivityAt && lastActivityAt > 0 ? lastActivityAt : Date.now();

    const interval = setInterval(() => {
      const now = Date.now();
      const idleFor = now - baseline;

      // Clear on fresh activity or when loading finishes
      if (!isLoading || (lastActivityAt && lastActivityAt > baseline)) {
        if (alertText) setAlertText(null);
        return;
      }

      if (!warned && idleFor >= idleWarnMs) {
        setAlertText(
          "Still processing… you can press Stop to abort and retry if needed.",
        );
        warned = true;
      }

      if (!escalated && idleFor >= idleCriticalMs) {
        setAlertText(
          "Processing is taking longer than expected. Consider pressing Stop, checking provider status, or switching model.",
        );
        escalated = true;
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [
    isLoading,
    lastActivityAt,
    connection?.isConnected,
    setAlertText,
    alertText,
    idleWarnMs,
    idleCriticalMs,
  ]);
}
