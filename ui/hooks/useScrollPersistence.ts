import { useEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import { currentSessionIdAtom } from '../state/atoms';

const LS_SCROLL_KEY = 'htos_scroll_positions';

function getScrollPositionsMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(LS_SCROLL_KEY);
    return raw ? JSON.parse(raw) as Record<string, number> : {};
  } catch {
    return {};
  }
}

function saveScrollPositionLS(sid: string, pos: number) {
  if (!sid) return;
  const map = getScrollPositionsMap();
  map[sid] = Math.max(0, Math.floor(pos));
  try { localStorage.setItem(LS_SCROLL_KEY, JSON.stringify(map)); } catch {}
}

function getScrollPositionLS(sid: string): number | null {
  if (!sid) return null;
  const map = getScrollPositionsMap();
  const v = map[sid];
  return typeof v === 'number' ? v : null;
}

export function useScrollPersistence() {
  const [currentSessionId] = useAtom(currentSessionIdAtom as any) as [string | null, any];
  const scrollerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const handleSave = () => {
      if (currentSessionId && scrollerRef.current) {
        try { saveScrollPositionLS(String(currentSessionId), scrollerRef.current.scrollTop); } catch {}
      }
    };

    const onVis = () => {
      if (document.visibilityState === 'hidden') handleSave();
    };

    window.addEventListener('beforeunload', handleSave);
    document.addEventListener('visibilitychange', onVis);

    return () => {
      window.removeEventListener('beforeunload', handleSave);
      document.removeEventListener('visibilitychange', onVis);
      handleSave();
    };
  }, [currentSessionId]);

  useEffect(() => {
    if (!currentSessionId) return;
    setTimeout(() => {
      const pos = getScrollPositionLS(String(currentSessionId));
      if (pos !== null && scrollerRef.current) {
        try { scrollerRef.current.scrollTo?.({ top: pos, behavior: 'auto' } as any); } catch {}
      }
    }, 100);
  }, [currentSessionId]);

  return scrollerRef;
}