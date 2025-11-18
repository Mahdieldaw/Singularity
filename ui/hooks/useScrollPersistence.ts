import { useRef } from "react";

const LS_SCROLL_KEY = "htos_scroll_positions";

function getScrollPositionsMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(LS_SCROLL_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function saveScrollPositionLS(sid: string, pos: number) {
  if (!sid) return;
  const map = getScrollPositionsMap();
  map[sid] = Math.max(0, Math.floor(pos));
  try {
    localStorage.setItem(LS_SCROLL_KEY, JSON.stringify(map));
  } catch {}
}

function getScrollPositionLS(sid: string): number | null {
  if (!sid) return null;
  const map = getScrollPositionsMap();
  const v = map[sid];
  return typeof v === "number" ? v : null;
}

// This hook is now ONLY responsible for saving/restoring scroll position across sessions.
// All live streaming scroll logic has been removed.
export function useScrollPersistence() {
  // Temporarily disabled: no save/restore during troubleshooting scroll behavior
  const scrollerRef = useRef<HTMLElement | null>(null);
  return scrollerRef;
}
