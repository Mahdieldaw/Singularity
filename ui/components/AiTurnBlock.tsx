// ui/components/AiTurnBlock.tsx - HYBRID COLLAPSIBLE SOLUTION
import React from "react";
import { AiTurn, ProviderResponse, AppStep } from "../types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
} from "react";
import { hasComposableContent } from "../utils/composerUtils";
import { LLM_PROVIDERS_CONFIG } from "../constants";
import ClipsCarousel from "./ClipsCarousel";
import { ChevronDownIcon, ChevronUpIcon, ListIcon } from "./Icons";
import {
  normalizeResponseArray,
  getLatestResponse,
} from "../utils/turn-helpers";

function parseMappingResponse(response?: string | null) {
 
  if (!response) return { mapping: "", options: null };

  const separator = "===ALL_AVAILABLE_OPTIONS===";

  if (response.includes(separator)) {
   const [mainMapping, optionsSection] = response.split(separator);
    return {
      mapping: mainMapping.trim(),
      options: optionsSection.trim(),
    };
  }

  const optionsPatterns = [
    /\*\*All Available Options:\*\*/i,
    /## All Available Options/i,
    /All Available Options:/i,
  ];

  for (const pattern of optionsPatterns) {
    const match = response.match(pattern);
    if (match && typeof match.index === "number") {
      const splitIndex = match.index;
      return {
        mapping: response.substring(0, splitIndex).trim(),
        options: response.substring(splitIndex).trim(),
      };
    }
  }

  return {
    mapping: response,
    options: null,
  };
}

/**
 * Cooperative height measurement hook - pauses during user interaction
 */
const useShorterHeight = (
  hasSynthesis: boolean,
  hasMapping: boolean,
  synthesisVersion: string | number,
  pause: boolean
) => {
  const synthRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);

  const [shorterHeight, setShorterHeight] = useState<number | null>(null);
  const [shorterSection, setShorterSection] = useState<
    "synthesis" | "mapping" | null
  >(null);

  const isUserActive = useRef(false);
  const userActiveTimer = useRef<number | null>(null);
  const rafId = useRef<number | null>(null);

  const measureOnce = useCallback(() => {
    if (pause) return;
    const s = synthRef.current;
    const m = mapRef.current;

    if (!hasSynthesis || !hasMapping || !s || !m) {
      setShorterHeight(null);
      setShorterSection(null);
      return;
    }

    // Skip measurement during user interaction to avoid thrash
    if (isUserActive.current) return;

    const synthH = s.scrollHeight;
    const mapH = m.scrollHeight;

    const isSynthShorter = synthH <= mapH;
    const h = isSynthShorter ? synthH : mapH;
    const sec = isSynthShorter ? "synthesis" : "mapping";

    // Only update if changed by more than 2px to avoid micro-adjustments
    setShorterHeight((prev) =>
      prev === null || Math.abs(prev - h) > 2 ? h : prev
    );
    setShorterSection((prev) => (prev !== sec ? sec : prev));
  }, [hasSynthesis, hasMapping, pause]);

  const scheduleMeasure = useCallback(() => {
    if (rafId.current !== null) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      measureOnce();
    });
  }, [measureOnce]);

  useEffect(() => {
    const s = synthRef.current;
    const m = mapRef.current;
    if (!s || !m) return;

    const ro = new ResizeObserver(() => scheduleMeasure());
    ro.observe(s);
    ro.observe(m);

    const markUserActive = () => {
      isUserActive.current = true;
      if (userActiveTimer.current !== null) {
        window.clearTimeout(userActiveTimer.current);
      }
      userActiveTimer.current = window.setTimeout(() => {
        isUserActive.current = false;
        userActiveTimer.current = null;
        scheduleMeasure();
      }, 300);
    };

    // Listen for user interactions
    const events = ["wheel", "touchstart", "pointerdown"];
    events.forEach((evt) => {
      s.addEventListener(evt, markUserActive, { passive: true });
      m.addEventListener(evt, markUserActive, { passive: true });
    });

    scheduleMeasure(); // initial

    return () => {
      ro.disconnect();
      if (rafId.current) cancelAnimationFrame(rafId.current);
      if (userActiveTimer.current) window.clearTimeout(userActiveTimer.current);
      events.forEach((evt) => {
        s.removeEventListener(evt, markUserActive as EventListener);
        m.removeEventListener(evt, markUserActive as EventListener);
      });
    };
  }, [scheduleMeasure]);

  useLayoutEffect(() => {
    if (!hasSynthesis || !hasMapping || pause) return;
    const id = requestAnimationFrame(measureOnce);
    return () => cancelAnimationFrame(id);
  }, [synthesisVersion, hasSynthesis, hasMapping, pause, measureOnce]);

  return { synthRef, mapRef, shorterHeight, shorterSection };
};

interface AiTurnBlockProps {
  aiTurn: AiTurn;
  isLive?: boolean;
  isReducedMotion?: boolean;
  isLoading?: boolean;
  activeRecomputeState?: {
    aiTurnId: string;
    stepType: "synthesis" | "mapping";
    providerId: string;
  } | null;
  currentAppStep?: AppStep;
  showSourceOutputs?: boolean;
  onToggleSourceOutputs?: () => void;
  onEnterComposerMode?: (aiTurn: AiTurn) => void;
  activeSynthesisClipProviderId?: string;
  activeMappingClipProviderId?: string;
  onClipClick?: (type: "synthesis" | "mapping", providerId: string) => void;
  children?: React.ReactNode;
}

const AiTurnBlock: React.FC<AiTurnBlockProps> = ({
  aiTurn,
  onToggleSourceOutputs,
  showSourceOutputs = false,
  onEnterComposerMode,
  isReducedMotion = false,
  isLoading = false,
  isLive = false,
  currentAppStep,
  activeRecomputeState = null,
  activeSynthesisClipProviderId,
  activeMappingClipProviderId,
  onClipClick,
  children,
}) => {
  const [isSynthesisExpanded, setIsSynthesisExpanded] = useState(true);
  const [isMappingExpanded, setIsMappingExpanded] = useState(true);
  const [mappingTab, setMappingTab] = useState<"map" | "options">("map");

  // Selection menu for "Extract to Canvas"
  const [selectionMenu, setSelectionMenu] = useState<{ x: number; y: number; text: string; provenance: any } | null>(null);
  const hideSelectionMenu = useCallback(() => setSelectionMenu(null), []);
  useEffect(() => {
    const onScroll = () => hideSelectionMenu();
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [hideSelectionMenu]);

  const showSelectionMenu = useCallback(
    (e: React.MouseEvent, responseType: "synthesis" | "mapping", providerId: string, sourceText: string) => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const selected = sel.toString().trim();
      if (!selected) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setSelectionMenu({
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY - 36,
        text: selected,
        provenance: {
          source: "ai",
          sessionId: aiTurn.sessionId,
          aiTurnId: aiTurn.id,
          providerId: providerId || "unknown",
          responseType,
          responseIndex: 0,
          timestamp: Date.now(),
          granularity: "fragment",
          sourceText,
        },
      });
    },
    [aiTurn.sessionId, aiTurn.id]
  );

  // Track which section is manually expanded (if truncated)
  const [synthExpanded, setSynthExpanded] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);

  // ✅ CRITICAL: Move all hooks to top level (before any conditional logic)
  const handleEnterComposerMode = useCallback(() => {
    onEnterComposerMode?.(aiTurn);
  }, [onEnterComposerMode, aiTurn]);

  const synthesisResponses = useMemo(() => {
    if (!aiTurn.synthesisResponses) aiTurn.synthesisResponses = {};
    const out: Record<string, ProviderResponse[]> = {};
    LLM_PROVIDERS_CONFIG.forEach((p) => (out[String(p.id)] = []));
    Object.entries(aiTurn.synthesisResponses).forEach(([pid, resp]) => {
      out[pid] = normalizeResponseArray(resp);
    });
    return out;
  }, [aiTurn.id, JSON.stringify(aiTurn.synthesisResponses)]);

  const mappingResponses = useMemo(() => {
    const map = aiTurn.mappingResponses || {};
    const out: Record<string, ProviderResponse[]> = {};
    LLM_PROVIDERS_CONFIG.forEach((p) => (out[String(p.id)] = []));
    Object.entries(map).forEach(([pid, resp]) => {
      out[pid] = normalizeResponseArray(resp);
    });
    return out;
  }, [aiTurn.id, JSON.stringify(aiTurn.mappingResponses)]);

  const allSources = useMemo(() => {
    const sources: Record<string, ProviderResponse> = {
      ...(aiTurn.batchResponses || {}),
    };
    if (aiTurn.hiddenBatchOutputs) {
      Object.entries(aiTurn.hiddenBatchOutputs).forEach(
        ([providerId, response]) => {
          if (!sources[providerId]) {
            const typedResponse = response as ProviderResponse;
            sources[providerId] = {
              providerId,
              text: typedResponse.text || "",
              status: "completed" as const,
              createdAt: typedResponse.createdAt || Date.now(),
              updatedAt: typedResponse.updatedAt || Date.now(),
            } as ProviderResponse;
          }
        }
      );
    }
    return sources;
  }, [aiTurn.batchResponses, aiTurn.hiddenBatchOutputs]);

  const hasSources = Object.keys(allSources).length > 0;

  const providerIds = useMemo(
    () => LLM_PROVIDERS_CONFIG.map((p) => String(p.id)),
    []
  );

  const computeActiveProvider = useCallback(
    (
      explicit: string | undefined,
      map: Record<string, ProviderResponse[]>
    ): string | undefined => {
      if (explicit) return explicit;
      for (const pid of providerIds) {
        const arr = map[pid];
        if (arr && arr.length > 0) return pid;
      }
      return undefined;
    },
    [providerIds]
  );

  const activeSynthPid = computeActiveProvider(
    activeSynthesisClipProviderId,
    synthesisResponses
  );
  const activeMappingPid = computeActiveProvider(
    activeMappingClipProviderId,
    mappingResponses
  );

  const isSynthesisTarget = !!(
    activeRecomputeState &&
    activeRecomputeState.aiTurnId === aiTurn.id &&
    activeRecomputeState.stepType === "synthesis" &&
    (!activeSynthPid || activeRecomputeState.providerId === activeSynthPid)
  );
  const isMappingTarget = !!(
    activeRecomputeState &&
    activeRecomputeState.aiTurnId === aiTurn.id &&
    activeRecomputeState.stepType === "mapping" &&
    (!activeMappingPid || activeRecomputeState.providerId === activeMappingPid)
  );

  const getMappingAndOptions = useCallback(
    (take: ProviderResponse | undefined) => {
      // Swap synthesis parsing to mapping parsing
      if (!take?.text) return { mapping: "", options: null };
      return parseMappingResponse(String(take.text));
 
  },
  []
);

const getOptions = useCallback((): string | null => {
  if (!activeMappingPid) return null;
  const take = getLatestResponse(mappingResponses[activeMappingPid]);
  const { options } = getMappingAndOptions(take);
  return options;
}, [activeMappingPid, mappingResponses, getMappingAndOptions]);
const displayedMappingTake = useMemo(() => {
  if (!activeMappingPid) return undefined;
  return getLatestResponse(mappingResponses[activeMappingPid]);
}, [activeMappingPid, mappingResponses]);

const displayedMappingText = useMemo(() => {
  if (!displayedMappingTake?.text) return "";
  return String(
    getMappingAndOptions(displayedMappingTake).mapping ?? ""
  );
}, [displayedMappingTake, getMappingAndOptions]);
 
const hasMapping = !!(activeMappingPid && displayedMappingTake?.text);
const hasSynthesis = !!(
  activeSynthPid && 
  getLatestResponse(synthesisResponses[activeSynthPid])?.text
  );

  // Respect requested features intent (backward-compatible default true)
  const requestedSynth = (aiTurn.meta as any)?.requestedFeatures?.synthesis;
  const requestedMap = (aiTurn.meta as any)?.requestedFeatures?.mapping;
  const wasSynthRequested = requestedSynth === undefined ? true : !!requestedSynth;
  const wasMapRequested = requestedMap === undefined ? true : !!requestedMap;

  const { synthRef, mapRef, shorterHeight, shorterSection } = useShorterHeight(
    hasSynthesis,
    hasMapping,
    displayedMappingText,
    isLive || isLoading
  );

  // Determine if sections are truncated
  const synthTruncated =
    hasSynthesis && hasMapping && shorterHeight && shorterSection === "mapping";
  const mapTruncated =
    hasSynthesis &&
    hasMapping &&
    shorterHeight &&
    shorterSection === "synthesis";

  const getSectionStyle = (
    section: "synthesis" | "mapping",
    isExpanded: boolean
  ): React.CSSProperties => {
    const isTruncated = section === "synthesis" ? synthTruncated : mapTruncated;
    const duringStreaming = isLive || isLoading;

    return {
      border: "1px solid #475569",
      borderRadius: 8,
      padding: 12,

      // ✅ CRITICAL FIX: Explicit flex properties
      flex: "1 1 0%", // Equal flex basis, ignore intrinsic width
      minWidth: 0, // Allow shrinking below content width

      display: "flex",
      flexDirection: "column",
      minHeight: 150,
      height: "auto",
      boxSizing: "border-box",
      maxHeight: isTruncated && !isExpanded ? `${shorterHeight}px` : "none",
      overflow: duringStreaming ? "hidden" : "visible",
      position: "relative",
    };
  };

  // (DOM version: no hrefs)
  const transformCitations = useCallback((text: string) => {
    if (!text) return "";
    let t = text;
    // [[CITE:N]] -> ↗N
    t = t.replace(/\[\[CITE:(\d+)\]\]/g, (_, num) => `↗${num}`);
    // [1, 2, 3] -> ↗1 ↗2 ↗3
    t = t.replace(/\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g, (m, grp) => {
      const nums = String(grp)
        .split(/\s*,\s*/)
        .map((n) => n.trim())
        .filter(Boolean);
      return nums.map((n) => `↗${n}`).join(" ");
    });
    return t;
  }, []);

  const handleCitationClick = useCallback(
    (modelNumber: number) => {
      try {
        // Ensure sources are visible when clicking a citation
        if (!showSourceOutputs) {
          onToggleSourceOutputs?.();
        }

        // Prefer mapping meta citationSourceOrder if present
        const take = activeMappingPid
          ? getLatestResponse(mappingResponses[activeMappingPid])
          : undefined;
        const metaOrder = (take as any)?.meta?.citationSourceOrder || null;

        let providerId: string | undefined;
        if (metaOrder && typeof metaOrder === "object") {
          providerId = metaOrder[modelNumber];
        }
        // Fallback: use the stable UI provider order, filtered to only those with outputs,
        // so 1→first active provider, 2→second, etc. This matches the user's expectation.
        if (!providerId) {
          const activeOrdered = LLM_PROVIDERS_CONFIG
            .map((p) => String(p.id))
            .filter((pid) => !!(aiTurn.batchResponses || {})[pid]);
          providerId = activeOrdered[modelNumber - 1];
        }
        if (!providerId) return;

        setTimeout(() => {
          const evt = new CustomEvent("htos:scrollToProvider", {
            detail: { aiTurnId: aiTurn.id, providerId },
            bubbles: true,
          });
          document.dispatchEvent(evt);
        }, 200);
      } catch (e) {
        console.warn("[AiTurnBlock] Citation click failed", e);
      }
    },
    [activeMappingPid, mappingResponses, showSourceOutputs, onToggleSourceOutputs, aiTurn.id, aiTurn.batchResponses]
  );

  // Capture-phase DOM interception for any <a href="citation://N"> clicks that might
  // slip through ReactMarkdown or browser defaults. This mirrors the composer path's
  // DOM-based navigation approach so we always scroll in-place rather than opening a new tab.
  const interceptCitationAnchorClick = useCallback((e: React.MouseEvent) => {
    try {
      const target = e.target as HTMLElement | null;
      const anchor = target ? (target.closest('a[href^="citation:"]') as HTMLAnchorElement | null) : null;
      if (anchor) {
        e.preventDefault();
        e.stopPropagation();
        const href = anchor.getAttribute('href') || '';
        const numMatch = href.match(/(\d+)/);
        const num = numMatch ? parseInt(numMatch[1], 10) : NaN;
        if (!isNaN(num)) {
          handleCitationClick(num);
        }
      }
    } catch (err) {
      console.warn('[AiTurnBlock] interceptCitationAnchorClick error', err);
    }
  }, [handleCitationClick]);

  // Also intercept middle/aux clicks and Ctrl/Cmd+Click, which browsers treat as "open in new tab"
  const interceptCitationMouseDownCapture = useCallback((e: React.MouseEvent) => {
    try {
      const target = e.target as HTMLElement | null;
      const anchor = target ? (target.closest('a[href^="citation:"]') as HTMLAnchorElement | null) : null;
      if (!anchor) return;
      const isAux = (e as any).button && (e as any).button !== 0;
      const isModifier = (e.ctrlKey || (e as any).metaKey);
      if (isAux || isModifier) {
        e.preventDefault();
        e.stopPropagation();
        const href = anchor.getAttribute('href') || '';
        const numMatch = href.match(/(\d+)/);
        const num = numMatch ? parseInt(numMatch[1], 10) : NaN;
        if (!isNaN(num)) handleCitationClick(num);
      }
    } catch (err) {
      console.warn('[AiTurnBlock] interceptCitationMouseDownCapture error', err);
    }
  }, [handleCitationClick]);

  // Intercept pointer down too (some environments dispatch pointer events before mouse/click)
  const interceptCitationPointerDownCapture = useCallback((e: React.PointerEvent) => {
    try {
      const target = e.target as HTMLElement | null;
      const anchor = target ? (target.closest('a[href^="citation:"]') as HTMLAnchorElement | null) : null;
      if (!anchor) return;
      const isAux = e.button !== 0;
      const isModifier = (e.ctrlKey || (e as any).metaKey);
      if (isAux || isModifier) {
        e.preventDefault();
        e.stopPropagation();
        const href = anchor.getAttribute('href') || '';
        const numMatch = href.match(/(\d+)/);
        const num = numMatch ? parseInt(numMatch[1], 10) : NaN;
        if (!isNaN(num)) handleCitationClick(num);
      }
    } catch (err) {
      console.warn('[AiTurnBlock] interceptCitationPointerDownCapture error', err);
    }
  }, [handleCitationClick]);

  // Intercept mouseup similar to composer badge to block finalization of native click/tab behaviors
  const interceptCitationMouseUpCapture = useCallback((e: React.MouseEvent) => {
    try {
      const target = e.target as HTMLElement | null;
      const anchor = target ? (target.closest('a[href^="citation:"]') as HTMLAnchorElement | null) : null;
      if (!anchor) return;
      e.preventDefault();
      e.stopPropagation();
      const href = anchor.getAttribute('href') || '';
      const numMatch = href.match(/(\d+)/);
      const num = numMatch ? parseInt(numMatch[1], 10) : NaN;
      if (!isNaN(num)) handleCitationClick(num);
    } catch (err) {
      console.warn('[AiTurnBlock] interceptCitationMouseUpCapture error', err);
    }
  }, [handleCitationClick]);

  // Explicitly intercept auxclick (middle click) to prevent new-tab navigation
  const interceptCitationAuxClickCapture = useCallback((e: React.MouseEvent) => {
    try {
      const target = e.target as HTMLElement | null;
      const anchor = target ? (target.closest('a[href^="citation:"]') as HTMLAnchorElement | null) : null;
      if (!anchor) return;
      const isAux = (e as any).button && (e as any).button !== 0;
      if (isAux) {
        e.preventDefault();
        e.stopPropagation();
        const href = anchor.getAttribute('href') || '';
        const numMatch = href.match(/(\d+)/);
        const num = numMatch ? parseInt(numMatch[1], 10) : NaN;
        if (!isNaN(num)) handleCitationClick(num);
      }
    } catch (err) {
      console.warn('[AiTurnBlock] interceptCitationAuxClickCapture error', err);
    }
  }, [handleCitationClick]);

  // Global capture-phase guard to ensure citation:// never triggers browser navigation
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      try {
        const target = e.target as HTMLElement | null;
        const anchor = target ? (target.closest('a[href^="citation:"]') as HTMLAnchorElement | null) : null;
        if (!anchor) return;
        e.preventDefault();
        e.stopPropagation();
        const href = anchor.getAttribute('href') || '';
        const numMatch = href.match(/(\d+)/);
        const num = numMatch ? parseInt(numMatch[1], 10) : NaN;
        if (!isNaN(num)) handleCitationClick(num);
      } catch (err) {
        console.warn('[AiTurnBlock] global citation click intercept error', err);
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      try {
        const target = e.target as HTMLElement | null;
        const anchor = target ? (target.closest('a[href^="citation:"]') as HTMLAnchorElement | null) : null;
        if (!anchor) return;
        e.preventDefault();
        e.stopPropagation();
        const href = anchor.getAttribute('href') || '';
        const numMatch = href.match(/(\d+)/);
        const num = numMatch ? parseInt(numMatch[1], 10) : NaN;
        if (!isNaN(num)) handleCitationClick(num);
      } catch (err) {
        console.warn('[AiTurnBlock] global citation mouseup intercept error', err);
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      try {
        const target = e.target as HTMLElement | null;
        const anchor = target ? (target.closest('a[href^="citation:"]') as HTMLAnchorElement | null) : null;
        if (!anchor) return;
        const isAux = (e as any).button && (e as any).button !== 0;
        const isModifier = (e.ctrlKey || (e as any).metaKey);
        if (isAux || isModifier) {
          e.preventDefault();
          e.stopPropagation();
          const href = anchor.getAttribute('href') || '';
          const numMatch = href.match(/(\d+)/);
          const num = numMatch ? parseInt(numMatch[1], 10) : NaN;
          if (!isNaN(num)) handleCitationClick(num);
        }
      } catch (err) {
        console.warn('[AiTurnBlock] global citation mousedown intercept error', err);
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      try {
        const target = e.target as HTMLElement | null;
        const anchor = target ? (target.closest('a[href^="citation:"]') as HTMLAnchorElement | null) : null;
        if (!anchor) return;
        const isAux = e.button !== 0;
        const isModifier = (e.ctrlKey || (e as any).metaKey);
        if (isAux || isModifier) {
          e.preventDefault();
          e.stopPropagation();
          const href = anchor.getAttribute('href') || '';
          const numMatch = href.match(/(\d+)/);
          const num = numMatch ? parseInt(numMatch[1], 10) : NaN;
          if (!isNaN(num)) handleCitationClick(num);
        }
      } catch (err) {
        console.warn('[AiTurnBlock] global citation pointerdown intercept error', err);
      }
    };

    document.addEventListener('click', onClick, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    // Some environments dispatch auxclick for middle-click; capture to block new-tab
    document.addEventListener('auxclick', onMouseDown as any, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('mouseup', onMouseUp, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('auxclick', onMouseDown as any, true);
    };
  }, [handleCitationClick]);

  const CitationLink: React.FC<any> = ({ href, children, ...props }) => {
    const isCitation = typeof href === "string" && href.startsWith("citation:");

    if (!isCitation) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
          {children}
        </a>
      );
    }

    const numMatch = String(href).match(/(\d+)/);
    const modelNumber = numMatch ? parseInt(numMatch[1], 10) : NaN;

    return (
      <span
        className="citation-badge"
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleCitationClick(modelNumber);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleCitationClick(modelNumber);
          }
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "2px 10px",
          marginLeft: 6,
          marginRight: 6,
          background: "#2563eb", // solid blue
          border: "1px solid #1d4ed8",
          borderRadius: 9999, // pill
          color: "#ffffff",
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
          transition: "opacity 0.2s ease",
          userSelect: "none",
          lineHeight: 1.4,
          boxShadow: "0 0 0 1px rgba(29,78,216,0.6)",
        }}
        title={`Jump to Model ${modelNumber}`}
      >
        {children}
      </span>
    );
  };

  

  // DOM version: aggressively replace any rendered <a href="citation://N"> inside the mapping box
  // with real <button> elements that call handleCitationClick(N). This avoids relying on
  // ReactMarkdown's anchor overrides and guarantees no browser navigation.
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;

    let rafId: number | null = null;
    const created: Array<{ btn: HTMLButtonElement; handler: (e: MouseEvent) => void }> = [];

    rafId = requestAnimationFrame(() => {
      const anchors = Array.from(m.querySelectorAll('a[href^="citation:"]')) as HTMLAnchorElement[];
      anchors.forEach((a) => {
        if (!(a && a.isConnected && a.ownerDocument === document)) return;
        const href = a.getAttribute('href') || '';
        const numMatch = href.match(/(\d+)/);
        const num = numMatch ? parseInt(numMatch[1], 10) : NaN;
        const label = a.textContent || (isNaN(num) ? '↗' : `↗${num}`);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-citation', String(num));
        btn.setAttribute('aria-label', isNaN(num) ? 'Citation' : `Citation ${num}`);
        btn.textContent = label;
        btn.style.display = 'inline-flex';
        btn.style.alignItems = 'center';
        btn.style.gap = '6px';
        btn.style.padding = '2px 10px';
        btn.style.marginLeft = '6px';
        btn.style.marginRight = '6px';
        btn.style.background = '#2563eb';
        btn.style.border = '1px solid #1d4ed8';
        btn.style.borderRadius = '9999px';
        btn.style.color = '#ffffff';
        btn.style.fontSize = '12px';
        btn.style.fontWeight = '700';
        btn.style.cursor = 'pointer';
        btn.style.userSelect = 'none';
        btn.style.lineHeight = '1.4';
        btn.style.boxShadow = '0 0 0 1px rgba(29,78,216,0.6)';

        const handler = (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          if (!isNaN(num)) handleCitationClick(num);
        };
        btn.addEventListener('click', handler, { capture: true });
        created.push({ btn, handler });

        try {
          if (a.isConnected && a.parentNode) {
            a.replaceWith(btn);
          }
        } catch (err) {
          console.warn('[AiTurnBlock] replace citation anchor failed', err);
        }
      });
    });

    return () => {
      if (rafId !== null) {
        try { cancelAnimationFrame(rafId); } catch {}
      }
      created.forEach(({ btn, handler }) => {
        try { btn.removeEventListener('click', handler, { capture: true } as any); } catch {}
      });
    };
  }, [mapRef, displayedMappingText, activeMappingPid]);

  // DOM version: wrap plain text tokens "↗N" into clickable buttons inside the mapping box
  useEffect(() => {
    const root = mapRef.current;
    if (!root) return;

    let rafId: number | null = null;
    const created: Array<{ btn: HTMLButtonElement; handler: (e: MouseEvent) => void }> = [];
    const rx = /↗(\d+)/g;

    const makeBtn = (num: number, label?: string) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-citation', String(num));
      btn.setAttribute('aria-label', `Citation ${num}`);
      btn.textContent = label || `↗${num}`;
      btn.style.display = 'inline-flex';
      btn.style.alignItems = 'center';
      btn.style.gap = '6px';
      btn.style.padding = '2px 10px';
      btn.style.marginLeft = '6px';
      btn.style.marginRight = '6px';
      btn.style.background = '#2563eb';
      btn.style.border = '1px solid #1d4ed8';
      btn.style.borderRadius = '9999px';
      btn.style.color = '#ffffff';
      btn.style.fontSize = '12px';
      btn.style.fontWeight = '700';
      btn.style.cursor = 'pointer';
      btn.style.userSelect = 'none';
      btn.style.lineHeight = '1.4';
      btn.style.boxShadow = '0 0 0 1px rgba(29,78,216,0.6)';
      const handler = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isNaN(num)) handleCitationClick(num);
      };
      btn.addEventListener('click', handler, { capture: true });
      created.push({ btn, handler });
      return btn;
    };

    rafId = requestAnimationFrame(() => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const toReplace: Array<{ node: Text; parts: (string | HTMLButtonElement)[] }> = [];
      let node: Node | null = walker.nextNode();
      while (node) {
        const textNode = node as Text;
        if (!(textNode && (textNode as any).isConnected)) {
          node = walker.nextNode();
          continue;
        }
        const value = textNode.nodeValue || '';
        let match: RegExpExecArray | null;
        rx.lastIndex = 0;
        let lastIdx = 0;
        const parts: (string | HTMLButtonElement)[] = [];
        while ((match = rx.exec(value)) !== null) {
          const start = match.index;
          const end = start + match[0].length;
          const num = parseInt(match[1], 10);
          if (start > lastIdx) parts.push(value.slice(lastIdx, start));
          parts.push(makeBtn(num));
          lastIdx = end;
        }
        if (parts.length > 0) {
          if (lastIdx < value.length) parts.push(value.slice(lastIdx));
          toReplace.push({ node: textNode, parts });
        }
        node = walker.nextNode();
      }

      toReplace.forEach(({ node, parts }) => {
        const frag = document.createDocumentFragment();
        parts.forEach((p) => {
          if (typeof p === 'string') frag.appendChild(document.createTextNode(p));
          else frag.appendChild(p);
        });
        try {
          if ((node as any).isConnected && node.parentNode) {
            node.parentNode.replaceChild(frag, node);
          }
        } catch (err) {
          console.warn('[AiTurnBlock] replace citation token failed', err);
        }
      });
    });

    return () => {
      if (rafId !== null) {
        try { cancelAnimationFrame(rafId); } catch {}
      }
      created.forEach(({ btn, handler }) => {
        try { btn.removeEventListener('click', handler, { capture: true } as any); } catch {}
      });
    };
  }, [mapRef, displayedMappingText]);

  const userPrompt: string | null = ((): string | null => {
    const maybe = aiTurn as any;
    return maybe?.userPrompt ?? maybe?.prompt ?? maybe?.input ?? null;
  })();

  return (
    <div
      className="turn-block"
      style={{ paddingBottom: "1rem", borderBottom: "1px solid #334155" }}
    >
      {userPrompt && (
        <div className="user-prompt-block" style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>
            User
          </div>
          <div
            style={{
              background: "#0b1220",
              border: "1px solid #334155",
              borderRadius: 8,
              padding: 8,
              color: "#cbd5e1",
            }}
          >
            {userPrompt}
          </div>
        </div>
      )}

      <div
        className="ai-turn-block"
        style={{ border: "1px solid #334155", borderRadius: 12, padding: 12 }}
      >
        <div
          className="ai-turn-content"
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <div
            className="primaries"
            style={{ marginBottom: "1rem", position: "relative" }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                gap: 12,
                alignItems: "flex-start",
              }}
            >
              {/* Synthesis Section */}
              <div
                ref={synthRef}
                className="synthesis-section"
                style={getSectionStyle("synthesis", synthExpanded)}
              >
                <div
                  className="section-header"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                    flexShrink: 0,
                  }}
                >
                  <h4 style={{ margin: 0, fontSize: 14, color: "#e2e8f0" }}>
                    Unified Synthesis
                  </h4>
                  <button
                    onClick={() => setIsSynthesisExpanded((p) => !p)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#94a3b8",
                      cursor: "pointer",
                      padding: 4,
                    }}
                  >
                    {isSynthesisExpanded ? (
                      <ChevronUpIcon style={{ width: 16, height: 16 }} />
                    ) : (
                      <ChevronDownIcon style={{ width: 16, height: 16 }} />
                    )}
                  </button>
                </div>

                {isSynthesisExpanded && (
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      minHeight: 0,
                      overflow:
                        synthTruncated && !synthExpanded ? "hidden" : "visible",
                    }}
                  >
                    <div style={{ flexShrink: 0 }}>
                      <ClipsCarousel
                        providers={LLM_PROVIDERS_CONFIG}
                        responsesMap={synthesisResponses}
                        activeProviderId={activeSynthPid}
                        onClipClick={(pid) => onClipClick?.("synthesis", pid)}
                        type="synthesis"
                      />
                    </div>

                    <div
                      className="clip-content"
                      style={{
                        marginTop: 12,
                        background: "#0f172a",
                        border: "1px solid #334155",
                        borderRadius: 8,
                        padding: 12,
                        paddingBottom: 18,
                        flex: 1,
                        minWidth: 0, // ← NEW
                        wordBreak: "break-word", // ← NEW
                        overflowWrap: "break-word", // ← NEW
                        overflowY: isLive || isLoading ? "auto" : "visible",
                        maxHeight: isLive || isLoading ? "40vh" : "none",
                        minHeight: 0,
                      }}
                      onClickCapture={interceptCitationAnchorClick}
                      onMouseDownCapture={interceptCitationMouseDownCapture}
                      onPointerDownCapture={interceptCitationPointerDownCapture}
                      onMouseUpCapture={interceptCitationMouseUpCapture}
                      onMouseUp={(e) => {
                        if (activeSynthPid) {
                          try {
                            const take = getLatestResponse(synthesisResponses[activeSynthPid]);
                            const sourceText = String(take?.text || "");
                            showSelectionMenu(e, "synthesis", activeSynthPid, sourceText);
                          } catch {}
                        }
                      }}
                      onAuxClickCapture={interceptCitationAuxClickCapture}
                      onWheelCapture={(e: React.WheelEvent<HTMLDivElement>) => {
                        const el = e.currentTarget;
                        const dy = e.deltaY ?? 0;
                        const canDown =
                          el.scrollTop + el.clientHeight < el.scrollHeight;
                        const canUp = el.scrollTop > 0;
                        if ((dy > 0 && canDown) || (dy < 0 && canUp)) {
                          e.stopPropagation();
                        }
                      }}
                      onWheel={(e: React.WheelEvent<HTMLDivElement>) => {
                        const el = e.currentTarget;
                        const dy = e.deltaY ?? 0;
                        const canDown =
                          el.scrollTop + el.clientHeight < el.scrollHeight;
                        const canUp = el.scrollTop > 0;
                        if ((dy > 0 && canDown) || (dy < 0 && canUp)) {
                          e.stopPropagation();
                        }
                      }}
                      onTouchStartCapture={(
                        e: React.TouchEvent<HTMLDivElement>
                      ) => {
                        e.stopPropagation();
                      }}
                      onTouchMove={(e: React.TouchEvent<HTMLDivElement>) => {
                        const el = e.currentTarget;
                        const canDown =
                          el.scrollTop + el.clientHeight < el.scrollHeight;
                        const canUp = el.scrollTop > 0;
                        if (canDown || canUp) {
                          e.stopPropagation();
                        }
                      }}
                    >
                      {(() => {
                        // If synthesis was not requested for this turn, show a clear placeholder
                        if (!wasSynthRequested) {
                          return (
                            <div style={{ color: "#64748b", fontStyle: "italic", textAlign: "center" }}>
                              Synthesis not enabled for this turn.
                            </div>
                          );
                        }
                        const latest = activeSynthPid
                          ? getLatestResponse(
                              synthesisResponses[activeSynthPid]
                            )
                          : undefined;
                        const isGenerating =
                          (latest &&
                            (latest.status === "streaming" ||
                              latest.status === "pending")) ||
                          isSynthesisTarget;
                        if (isGenerating) {
                          return (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 8,
                                color: "#94a3b8",
                              }}
                            >
                              <span style={{ fontStyle: "italic" }}>
                                Synthesis generating
                              </span>
                              <span className="streaming-dots" />
                            </div>
                          );
                        }
                        if (activeSynthPid) {
                          const take = getLatestResponse(
                                                          synthesisResponses[activeSynthPid]
                          // Error rendering for synthesis
                          )
                          if (take && take.status === "error") {
                            const errText = String(take.text || "Synthesis failed");
                            return (
                              <div
                                style={{
                                  background: "#1f2937",
                                  border: "1px solid #ef4444",
                                  color: "#fecaca",
                                  borderRadius: 8,
                                  padding: 12,
                                }}
                              >
                                <div style={{ fontSize: 12, marginBottom: 8 }}>
                                  {activeSynthPid} · error
                                </div>
                                <div className="prose prose-sm max-w-none dark:prose-invert" style={{ lineHeight: 1.7, fontSize: 14 }}>
                                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: CitationLink }}>
                                    {errText}
                                  </ReactMarkdown>
                                </div>
                              </div>
                            );
                          }
                          if (!take) {
                            return (
                              <div style={{ color: "#64748b" }}>
                                No synthesis yet for this model.
                              </div>
                            );
                          }
                          const handleCopy = async (e: React.MouseEvent) => {
                            e.stopPropagation();
                            try {
                              await navigator.clipboard.writeText(
                                String(take.text || "")
                              );
                            } catch (err) {
                              console.error("Copy failed", err);
                            }
                          };
                          return (
                            <div>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  gap: 8,
                                  marginBottom: 8,
                                }}
                              >
                                <div style={{ fontSize: 12, color: "#94a3b8" }}>
                                  {activeSynthPid} · {take.status}
                                </div>
                                <button
                                  onClick={handleCopy}
                                  style={{
                                    background: "#334155",
                                    border: "1px solid #475569",
                                    borderRadius: 6,
                                    padding: "4px 8px",
                                    color: "#94a3b8",
                                    fontSize: 12,
                                    cursor: "pointer",
                                  }}
                                >
                                  📋 Copy
                                </button>
                              </div>
                              <div
                                className="prose prose-sm max-w-none dark:prose-invert"
                                style={{ lineHeight: 1.7, fontSize: 16 }}
                                onMouseUp={(e) => showSelectionMenu(e, "synthesis", activeSynthPid || "unknown", String(take.text || ""))}
                              >
                                <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: CitationLink }}>
                                  {String(take.text || "")}
                                </ReactMarkdown>
                              </div>
                              {/* Synthesis actions: drag + scratchpad */}
                              {(() => {
                                const text = String(take.text || "");
                                const provenance = {
                                  source: "ai",
                                  sessionId: aiTurn.sessionId,
                                  aiTurnId: aiTurn.id,
                                  providerId: activeSynthPid || 'unknown',
                                  responseType: "synthesis",
                                  responseIndex: 0,
                                  timestamp: Date.now(),
                                  granularity: "full",
                                  sourceText: text,
                                } as any;
                                return (
                                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        try {
                                          document.dispatchEvent(new CustomEvent("extract-to-canvas", { detail: { text, provenance, targetColumn: 'left' }, bubbles: true }));
                                        } catch (err) {
                                          console.error("Add synthesis to scratchpad failed", err);
                                        }
                                      }}
                                      aria-label="Send synthesis to Scratchpad"
                                      style={{
                                        background: "#1d4ed8",
                                        border: "1px solid #334155",
                                        borderRadius: 6,
                                        padding: "4px 8px",
                                        color: "#ffffff",
                                        fontSize: 12,
                                        cursor: "pointer",
                                      }}
                                    >
                                      ↘ Scratchpad
                                    </button>
                                  </div>
                                );
                              })()}
                            </div>
                          );
                        }
                        return (
                          <div
                            style={{
                              color: "#64748b",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              height: "100%",
                              fontStyle: "italic",
                            }}
                          >
                            Choose a model to synthesize.
                          </div>
                        );
                      })()}
                    </div>

                    {/* Expand button for truncated content */}
                    {synthTruncated && !synthExpanded && (
                      <>
                        <div
                          style={{
                            position: "absolute",
                            bottom: 0,
                            left: 0,
                            right: 0,
                            height: 60,
                            background: "linear-gradient(transparent, #1e293b)",
                            pointerEvents: "none",
                            borderRadius: "0 0 8px 8px",
                          }}
                        />
                        {/* Always show actions in truncated view (overlay at bottom-left) */}
                        {(() => {
                          const latest = activeSynthPid
                            ? getLatestResponse(
                                synthesisResponses[activeSynthPid]
                              )
                            : undefined;
                          const text = String(latest?.text || "");
                          const provenance = {
                            source: "ai",
                            sessionId: aiTurn.sessionId,
                            aiTurnId: aiTurn.id,
                            providerId: activeSynthPid || 'unknown',
                            responseType: "synthesis",
                            responseIndex: 0,
                            timestamp: Date.now(),
                            granularity: "full",
                            sourceText: text,
                          } as any;
                          return (
                            <div
                              style={{
                                position: "absolute",
                                bottom: 12,
                                left: 12,
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                zIndex: 2,
                              }}
                            >
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  try {
                                    document.dispatchEvent(
                                      new CustomEvent("extract-to-canvas", {
                                        detail: { text, provenance, targetColumn: 'left' },
                                        bubbles: true,
                                      })
                                    );
                                  } catch (err) {
                                    console.error(
                                      "Add synthesis to scratchpad failed",
                                      err
                                    );
                                  }
                                }}
                                aria-label="Send synthesis to Scratchpad"
                                style={{
                                  background: "#1d4ed8",
                                  border: "1px solid #334155",
                                  borderRadius: 6,
                                  padding: "4px 8px",
                                  color: "#ffffff",
                                  fontSize: 12,
                                  cursor: "pointer",
                                }}
                              >
                                ↘ Scratchpad
                              </button>
                            </div>
                          );
                        })()}
                        <button
                          onClick={() => setSynthExpanded(true)}
                          style={{
                            position: "absolute",
                            bottom: 12,
                            left: "50%",
                            transform: "translateX(-50%)",
                            padding: "6px 12px",
                            background: "#334155",
                            border: "1px solid #475569",
                            borderRadius: 6,
                            color: "#e2e8f0",
                            cursor: "pointer",
                            fontSize: 12,
                            zIndex: 1,
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          Show full response{" "}
                          <ChevronDownIcon style={{ width: 14, height: 14 }} />
                        </button>
                      </>
                    )}

                    {synthExpanded && synthTruncated && (
                      <button
                        onClick={() => setSynthExpanded(false)}
                        style={{
                          marginTop: 12,
                          padding: "6px 12px",
                          background: "#334155",
                          border: "1px solid #475569",
                          borderRadius: 6,
                          color: "#94a3b8",
                          cursor: "pointer",
                          fontSize: 12,
                          alignSelf: "center",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <ChevronUpIcon style={{ width: 14, height: 14 }} />{" "}
                        Collapse
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Mapping Section */}
              <div
                ref={mapRef}
                className="mapping-section"
                style={getSectionStyle("mapping", mapExpanded)}
              >
                <div
                  className="section-header"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                    flexShrink: 0,
                  }}
                >
                  <h4 style={{ margin: 0, fontSize: 14, color: "#e2e8f0" }}>
                    Decision Map
                  </h4>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <button
                      onClick={() => setMappingTab("map")}
                      title="Decision Map"
                      style={{
                        padding: 6,
                        background:
                          mappingTab === "map" ? "#334155" : "transparent",
                        border: "none",
                        borderRadius: 4,
                        color: mappingTab === "map" ? "#e2e8f0" : "#64748b",
                        cursor: "pointer",
                        fontSize: 16,
                      }}
                    >
                      🗺️
                    </button>
                    <button
                      onClick={() => setMappingTab("options")}
        title="All Options"
        style={{
          padding: "4px 8px",
          background: mappingTab === "options" ? "#334155" : "transparent",
          border: mappingTab === "options" ? "1px solid #475569" : "1px solid transparent",
          borderRadius: 6,
          color: mappingTab === "options" ? "#e2e8f0" : "#94a3b8",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ListIcon style={{ width: 16, height: 16 }} />
      </button>
      <button
        onClick={async () => {
          // ... ✅ FIX "Copy All" logic here
          try {
            const ORDER = ["claude", "gemini-pro", "qwen", "chatgpt", "gemini"];
            const nameMap = new Map(LLM_PROVIDERS_CONFIG.map((p) => [String(p.id), p.name]));
            const lines: string[] = [];

            // Synthesis section
            ORDER.forEach((pid) => {
              const take = getLatestResponse(synthesisResponses[pid] || []);
              // ✅ FIXED: Get text from the 'take' object
              const text = take?.text ? String(take.text) : "";
              if (text && text.trim().length > 0) {
                lines.push(`=== Synthesis • ${nameMap.get(pid) || pid} ===`);
                lines.push(text.trim());
                lines.push("\n---\n");
              }
            });

            // Mapping section
            ORDER.forEach((pid) => {
              const take = getLatestResponse(mappingResponses[pid] || []);
              const text = take?.text ? String(take.text) : "";
              if (text && text.trim().length > 0) {
                lines.push(`=== Mapping • ${nameMap.get(pid) || pid} ===`);
                lines.push(text.trim());
                lines.push("\n---\n");
              }
            });

                          // Batch source responses (original providers)
                          ORDER.forEach((pid) => {
                            const source = allSources[pid];
                            const text = source?.text
                              ? String(source.text)
                              : "";
                            if (text && text.trim().length > 0) {
                              lines.push(`=== ${nameMap.get(pid) || pid} ===`);
                              lines.push(text);
                              lines.push("");
                              lines.push("---");
                              lines.push("");
                            }
                          });

                          const payload = lines.join("\n");
                          await navigator.clipboard.writeText(payload);
                        } catch (err) {
                          console.error("Copy All failed", err);
                        }
                      }}
                      title="Copy All"
                      style={{
                        padding: "4px 8px",
                        background: "#334155",
                        border: "1px solid #475569",
                        borderRadius: 6,
                        color: "#94a3b8",
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      📦 Copy All
                    </button>
                    <div
                      style={{
                        width: 1,
                        height: 16,
                        background: "#475569",
                        margin: "0 4px",
                      }}
                    />
                    <button
                      onClick={() => setIsMappingExpanded((p) => !p)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#94a3b8",
                        cursor: "pointer",
                        padding: 4,
                      }}
                    >
                      {isMappingExpanded ? (
                        <ChevronUpIcon style={{ width: 16, height: 16 }} />
                      ) : (
                        <ChevronDownIcon style={{ width: 16, height: 16 }} />
                      )}
                    </button>
                  </div>
                </div>

                {isMappingExpanded && (
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      overflow:
                        mapTruncated && !mapExpanded ? "hidden" : "visible",
                      minHeight: 0,
                    }}
                  >
                    {mappingTab === "map" && (
                      <ClipsCarousel
                        providers={LLM_PROVIDERS_CONFIG}
                        responsesMap={mappingResponses}
                        activeProviderId={activeMappingPid}
                        onClipClick={(pid) => onClipClick?.("mapping", pid)}
                        type="mapping"
                      />
                    )}

                  
      <div
        className="clip-content"
        style={{
          marginTop: 12,
          background: "#0f172a",
          border: "1px solid #334155",
          borderRadius: 8,
          padding: 12,
          paddingBottom: 18,
          flex: 1,
          minWidth: 0,
          wordBreak: "break-word",
          overflowWrap: "break-word",
          overflowY: isLive || isLoading ? "auto" : "visible",
          maxHeight: isLive || isLoading ? "40vh" : "none",
          minHeight: 0,
        }}
        onClickCapture={interceptCitationAnchorClick}
        onMouseDownCapture={interceptCitationMouseDownCapture}
        onPointerDownCapture={interceptCitationPointerDownCapture}
        onMouseUpCapture={interceptCitationMouseUpCapture}
        onMouseUp={(e) => {
          const text = String(displayedMappingText || "");
          if (activeMappingPid) {
            try {
              showSelectionMenu(e, "mapping", activeMappingPid, text);
            } catch {}
          }
        }}
        onAuxClickCapture={interceptCitationAuxClickCapture}
      >
        {/* Persistently mounted tab containers to avoid unmount/mount churn */}
        {(() => {
          const options = getOptions();
          const optionsInner = (() => {
            if (!options) {
              return (
                <div style={{ color: "#64748b" }}>
                  {!activeMappingPid
                    ? "Select a mapping provider to see options."
                    : "No options found in the mapping response."}
                </div>
              );
            }
            const text = String(options || "");
            const provenance = {
              source: "ai",
              sessionId: aiTurn.sessionId,
              aiTurnId: aiTurn.id,
              providerId: activeMappingPid || "unknown",
              responseType: "mapping",
              responseIndex: 0,
              timestamp: Date.now(),
              granularity: "full",
              sourceText: text,
            } as any;
            return (
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>
                    All Available Options • via {activeMappingPid}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      try {
                        navigator.clipboard.writeText(text);
                      } catch (err) {
                        console.error("Copy options failed", err);
                      }
                    }}
                    style={{
                      background: "#334155",
                      border: "1px solid #475569",
                      borderRadius: 6,
                      padding: "4px 8px",
                      color: "#94a3b8",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    📋 Copy
                  </button>
                </div>
                <div
                  className="prose prose-sm max-w-none dark:prose-invert"
                  style={{ lineHeight: 1.7, fontSize: 14 }}
                  onClickCapture={interceptCitationAnchorClick}
                  onMouseDownCapture={interceptCitationMouseDownCapture}
                  onPointerDownCapture={interceptCitationPointerDownCapture}
                  onMouseUp={(e) => {
                    try {
                      showSelectionMenu(e, "mapping", activeMappingPid || "unknown", text);
                    } catch {}
                  }}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{ a: CitationLink }}
                  >
                    {transformCitations(options)}
                  </ReactMarkdown>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 12,
                  }}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      try {
                        document.dispatchEvent(
                          new CustomEvent("extract-to-canvas", {
                            detail: { text, provenance, targetColumn: "left" },
                            bubbles: true,
                          })
                        );
                      } catch (err) {
                        console.error("Add options to scratchpad failed", err);
                      }
                    }}
                    aria-label="Send options to Scratchpad"
                    style={{
                      background: "#1d4ed8",
                      border: "1px solid #334155",
                      borderRadius: 6,
                      padding: "4px 8px",
                      color: "#ffffff",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    ↘ Scratchpad
                  </button>
                </div>
              </div>
            );
          })();

          const mapInner = (() => {
            if (!wasMapRequested) {
              return (
                <div
                  style={{
                    color: "#64748b",
                    fontStyle: "italic",
                    textAlign: "center",
                  }}
                >
                  Mapping not enabled for this turn.
                </div>
              );
            }
            const latest = displayedMappingTake;
            const isGenerating =
              (latest &&
                (latest.status === "streaming" || latest.status === "pending")) ||
              isMappingTarget;
            if (isGenerating) {
              return (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    color: "#94a3b8",
                  }}
                >
                  <span style={{ fontStyle: "italic" }}>
                    Conflict map generating
                  </span>
                  <span className="streaming-dots" />
                </div>
              );
            }
            if (activeMappingPid) {
              const take = displayedMappingTake;
              if (take && take.status === "error") {
                const errText = String(take.text || "Mapping failed");
                return (
                  <div
                    style={{
                      background: "#1f2937",
                      border: "1px solid #ef4444",
                      color: "#fecaca",
                      borderRadius: 8,
                      padding: 12,
                    }}
                  >
                    <div style={{ fontSize: 12, marginBottom: 8 }}>
                      {activeMappingPid} · error
                    </div>
                    <div
                      className="prose prose-sm max-w-none dark:prose-invert"
                      style={{ lineHeight: 1.7, fontSize: 14 }}
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {errText}
                      </ReactMarkdown>
                    </div>
                  </div>
                );
              }
              if (!take) {
                return (
                  <div style={{ color: "#64748b" }}>
                    No mapping yet for this model.
                  </div>
                );
              }

              const handleCopy = async (e: React.MouseEvent) => {
                e.stopPropagation();
                await navigator.clipboard.writeText(displayedMappingText);
              };
              return (
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>
                      {activeMappingPid} · {take.status}
                    </div>
                    <button
                      onClick={handleCopy}
                      style={{
                        background: "#334155",
                        border: "1px solid #475569",
                        borderRadius: 6,
                        padding: "4px 8px",
                        color: "#94a3b8",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      📋 Copy
                    </button>
                  </div>
                  <div
                    className="prose prose-sm max-w-none dark:prose-invert"
                    style={{ lineHeight: 1.7, fontSize: 16 }}
                    onClickCapture={interceptCitationAnchorClick}
                    onMouseDownCapture={interceptCitationMouseDownCapture}
                    onPointerDownCapture={interceptCitationPointerDownCapture}
                    onMouseUp={(e) => showSelectionMenu(e, "mapping", activeMappingPid || "unknown", String(displayedMappingText || ""))}
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: CitationLink }}>
                      {transformCitations(displayedMappingText)}
                    </ReactMarkdown>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginTop: 12,
                    }}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        try {
                          const text = String(displayedMappingText || "");
                          const provenance = {
                            source: "ai",
                            sessionId: aiTurn.sessionId,
                            aiTurnId: aiTurn.id,
                            providerId: activeMappingPid || "unknown",
                            responseType: "mapping",
                            responseIndex: 0,
                            timestamp: Date.now(),
                            granularity: "full",
                            sourceText: text,
                          } as any;
                          document.dispatchEvent(
                            new CustomEvent("extract-to-canvas", {
                              detail: { text, provenance, targetColumn: "left" },
                              bubbles: true,
                            })
                          );
                        } catch (err) {
                          console.error("Add mapping to scratchpad failed", err);
                        }
                      }}
                      aria-label="Send mapping to Scratchpad"
                      style={{
                        background: "#1d4ed8",
                        border: "1px solid #334155",
                        borderRadius: 6,
                        padding: "4px 8px",
                        color: "#ffffff",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      ↘ Scratchpad
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div
                style={{
                  color: "#64748b",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  fontStyle: "italic",
                }}
              >
                Choose a model to map.
              </div>
            );
          })();

          return (
            <>
              <div
                data-tab="options"
                style={{ display: mappingTab === "options" ? "block" : "none" }}
                onClickCapture={interceptCitationAnchorClick}
                onMouseDownCapture={interceptCitationMouseDownCapture}
                onPointerDownCapture={interceptCitationPointerDownCapture}
              >
                {optionsInner}
              </div>
              <div
                data-tab="map"
                style={{ display: mappingTab === "map" ? "block" : "none" }}
                onClickCapture={interceptCitationAnchorClick}
                onMouseDownCapture={interceptCitationMouseDownCapture}
                onPointerDownCapture={interceptCitationPointerDownCapture}
              >
                {mapInner}
              </div>
            </>
          );
        })()}
        {/* legacy conditional tab rendering removed; using persistent containers above */}
        
      </div>

      {/* Expand/Collapse buttons - your logic here was already correct */}
      {mapTruncated && !mapExpanded && mappingTab === "map" && (
                      <>
                        <div
                          style={{
                            position: "absolute",
                            bottom: 0,
                            left: 0,
                            right: 0,
                            height: 60,
                            background: "linear-gradient(transparent, #1e293b)",
                            pointerEvents: "none",
                            borderRadius: "0 0 8px 8px",
                          }}
                        />
                        {/* Always show actions in truncated mapping view (overlay at bottom-left) */}
                        {(() => {
                          const text = String(displayedMappingText || "");
                          const provenance = {
                            source: "ai",
                            sessionId: aiTurn.sessionId,
                            aiTurnId: aiTurn.id,
                            providerId: activeMappingPid || 'unknown',
                            responseType: "mapping",
                            responseIndex: 0,
                            timestamp: Date.now(),
                            granularity: "full",
                            sourceText: text,
                          } as any;
                          return (
                            <div
                              style={{
                                position: "absolute",
                                bottom: 12,
                                left: 12,
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                zIndex: 2,
                              }}
                            >
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  try {
                                    document.dispatchEvent(
                                      new CustomEvent("extract-to-canvas", {
                                        detail: { text, provenance, targetColumn: 'left' },
                                        bubbles: true,
                                      })
                                    );
                                  } catch (err) {
                                    console.error(
                                      "Add mapping to scratchpad failed",
                                      err
                                    );
                                  }
                                }}
                                aria-label="Send mapping to Scratchpad"
                                style={{
                                  background: "#1d4ed8",
                                  border: "1px solid #334155",
                                  borderRadius: 6,
                                  padding: "4px 8px",
                                  color: "#ffffff",
                                  fontSize: 12,
                                  cursor: "pointer",
                                }}
                              >
                                ↘ Scratchpad
                              </button>
                            </div>
                          );
                        })()}
                        <button
                          onClick={() => setMapExpanded(true)}
                          style={{
                            position: "absolute",
                            bottom: 12,
                            left: "50%",
                            transform: "translateX(-50%)",
                            padding: "6px 12px",
                            background: "#334155",
                            border: "1px solid #475569",
                            borderRadius: 6,
                            color: "#e2e8f0",
                            cursor: "pointer",
                            fontSize: 12,
                            zIndex: 1,
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          Show full response{" "}
                          <ChevronDownIcon style={{ width: 14, height: 14 }} />
                        </button>
                      </>
                    )}

                    {mapExpanded && mapTruncated && (
                      <button
                        onClick={() => setMapExpanded(false)}
                        style={{
                          marginTop: 12,
                          padding: "6px 12px",
                          background: "#334155",
                          border: "1px solid #475569",
                          borderRadius: 6,
                          color: "#94a3b8",
                          cursor: "pointer",
                          fontSize: 12,
                          alignSelf: "center",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <ChevronUpIcon style={{ width: 14, height: 14 }} />{" "}
                        Collapse
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {hasSources && (
              <div
                className="batch-filler"
                style={{
                  border: "1px solid #475569",
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <div className="sources-wrapper">
                  <div
                    className="sources-toggle"
                    style={{ textAlign: "center", marginBottom: 8 }}
                  >
                    <button
                      onClick={() => onToggleSourceOutputs?.()}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 8,
                        border: "1px solid #334155",
                        background: "#0b1220",
                        color: "#e2e8f0",
                        cursor: "pointer",
                      }}
                    >
                      {showSourceOutputs ? "Hide Sources" : "Show Sources"}
                    </button>
                  </div>
                  {showSourceOutputs && (
                    <div className="sources-content">{children}</div>
                  )}
                </div>
              </div>
            )}

            {hasComposableContent(aiTurn) && (
              <div className="composer-entry" style={{ textAlign: "center" }}>
                <button
                  onClick={handleEnterComposerMode}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid #334155",
                    background: "#1d4ed8",
                    color: "#fff",
                    cursor: "pointer",
                  }}
                >
                  Open in Composer
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {selectionMenu && (
        <div
          style={{
            position: "fixed",
            top: selectionMenu.y,
            left: selectionMenu.x,
            zIndex: 9999,
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              try {
                document.dispatchEvent(
                  new CustomEvent("extract-to-canvas", {
                    detail: { text: selectionMenu.text, provenance: selectionMenu.provenance, targetColumn: "left" },
                    bubbles: true,
                  })
                );
              } finally {
                hideSelectionMenu();
                const sel = window.getSelection();
                if (sel) sel.removeAllRanges();
              }
            }}
            style={{
              background: "#1d4ed8",
              border: "1px solid #334155",
              borderRadius: 6,
              padding: "4px 8px",
              color: "#ffffff",
              fontSize: 12,
              cursor: "pointer",
              boxShadow: "0 6px 20px rgba(0,0,0,0.3)",
            }}
          >
            Extract to Canvas
          </button>
        </div>
      )}
    </div>
  );
};

export default React.memo(AiTurnBlock);
