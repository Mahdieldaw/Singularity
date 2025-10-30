import React, { useEffect, useRef, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { TextSegment, Granularity } from '../../utils/segmentText';
import { createContentBlockDragData, DragData } from '../../types/dragDrop';
import { ProvenanceData } from './extensions/ComposedContentNode';

interface DraggableSegmentProps {
  segment: TextSegment;
  turnId: string;
  responseId: string;
  providerId: string;
  granularity: Granularity;
  provenance: ProvenanceData;
  sourceContext?: {
    beforeText?: string;
    afterText?: string;
    fullResponse?: string;
  };
  onPin?: (text: string, provenance: ProvenanceData) => void;
  onExtractToCanvas?: (text: string, provenance: ProvenanceData) => void;
}

export const DraggableSegment: React.FC<DraggableSegmentProps> = ({
  segment,
  turnId,
  responseId,
  providerId,
  granularity,
  provenance,
  sourceContext,
  onPin,
  onExtractToCanvas
}) => {
  const [showCopyButton, setShowCopyButton] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [extracted, setExtracted] = useState(false);
  const [isCompact, setIsCompact] = useState(false);
  const [arrowHover, setArrowHover] = useState(false);
  const segmentRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = segmentRef.current;
    if (!el) return;
    const check = () => {
      const h = el.offsetHeight || 0;
      setIsCompact(h <= 40);
    };
    check();
    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(() => check());
      ro.observe(el);
    } catch {}
    return () => {
      try { ro?.disconnect(); } catch {}
    };
  }, [segment.text, showCopyButton]);

  const dragData: DragData = createContentBlockDragData(
    segment.text,
    provenance,
    turnId,
    responseId,
    segment.id,
    providerId,
    granularity as DragData['metadata']['granularity'],
    sourceContext
  );

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${turnId}-${responseId}-${segment.id}`,
    data: dragData
  });

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(segment.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handlePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onPin) {
      onPin(segment.text, provenance);
      setPinned(true);
      setTimeout(() => setPinned(false), 1500);
    }
  };

  const handleExtractToCanvas = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onExtractToCanvas) {
      onExtractToCanvas(segment.text, provenance);
      setExtracted(true);
      setTimeout(() => setExtracted(false), 1500);
    }
  };

    const getSegmentStyles = () => {
    const ARROW_WIDTH = 24;
    const ARROW_GAP = 12;
    const extraRightPadding = onExtractToCanvas && granularity !== 'word' ? (ARROW_WIDTH + ARROW_GAP) : 0;

    const baseStyles = {
      cursor: 'grab',
      opacity: isDragging ? 0.5 : 1,
      background: isDragging 
        ? 'rgba(139, 92, 246, 0.2)' 
        : showCopyButton 
        ? 'rgba(139, 92, 246, 0.1)' 
        : 'transparent',
      border: `1px solid ${showCopyButton || isDragging ? 'rgba(139, 92, 246, 0.3)' : 'transparent'}`,
      transition: 'all 0.15s ease',
      position: 'relative' as const,
      borderRadius: '4px'
    };

    switch (granularity) {
      case 'paragraph':
        return {
          ...baseStyles,
          display: 'block',
          padding: `8px ${8 + extraRightPadding}px 8px 8px`,
          margin: '4px 0'
        };
      case 'sentence':
        return {
          ...baseStyles,
          display: 'inline-block',
          padding: `4px ${4 + extraRightPadding}px 4px 4px`,
          margin: '2px'
        };
      case 'word':
        return {
          ...baseStyles,
          display: 'inline',
          padding: `2px ${2 + extraRightPadding}px 2px 2px`,
          margin: '1px'
        };
      case 'full':
      default:
        return {
          ...baseStyles,
          display: 'block',
          padding: `12px ${12 + extraRightPadding}px 12px 12px`,
          margin: '8px 0'
        };
    }
  };


  return (
    <span
      ref={(node) => { setNodeRef(node as HTMLElement); segmentRef.current = node as HTMLSpanElement; }}
      {...listeners}
      {...attributes}
      onMouseEnter={() => setShowCopyButton(true)}
      onMouseLeave={() => setShowCopyButton(false)}
      style={getSegmentStyles()}
      className="draggable-segment"
    >
      {segment.text}
      {showCopyButton && granularity !== 'word' && (
        <>
          {onPin && isCompact && (
            <div style={{ position: 'absolute', right: '32px', top: '4px', zIndex: 10, display: 'flex', gap: '4px' }}>
              <button
                onClick={handlePin}
                style={{
                  background: pinned ? '#f59e0b' : '#8b5cf6',
                  border: '1px solid rgba(0,0,0,0.15)',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  fontSize: '10px',
                  color: 'white',
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                }}
                title="Pin this segment"
              >
                📌
              </button>
              <button
                onClick={handleCopy}
                style={{
                  background: copied ? '#10b981' : '#374151',
                  border: '1px solid rgba(0,0,0,0.15)',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  fontSize: '10px',
                  color: 'white',
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                }}
                title="Copy segment"
              >
                {copied ? '✓' : '📋'}
              </button>
            </div>
          )}

          {!isCompact && (
            <>
              {onPin && (
                <div style={{ position: 'absolute', right: '32px', top: '4px', zIndex: 10 }}>
                  <button
                    onClick={handlePin}
                    style={{
                      background: pinned ? '#f59e0b' : '#8b5cf6',
                      border: '1px solid rgba(0,0,0,0.15)',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      fontSize: '10px',
                      color: 'white',
                      cursor: 'pointer',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                    }}
                    title="Pin this segment"
                  >
                    📌
                  </button>
                </div>
              )}
              <div style={{ position: 'absolute', right: '32px', bottom: '4px', display: 'flex', gap: '4px', zIndex: 10 }}>
                <button
                  onClick={handleCopy}
                  style={{
                    background: copied ? '#10b981' : '#374151',
                    border: '1px solid rgba(0,0,0,0.15)',
                    borderRadius: '4px',
                    padding: '2px 6px',
                    fontSize: '10px',
                    color: 'white',
                    cursor: 'pointer',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                  }}
                  title="Copy segment"
                >
                  {copied ? '✓' : '📋'}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* Blue right arrow for extract to active canvas */}
      {onExtractToCanvas && granularity !== 'word' && (
        <div style={{ position: 'absolute', top: '50%', right: '-6px', transform: 'translateY(-50%)', zIndex: 30 }}>
          <button
            onClick={handleExtractToCanvas}
            onMouseEnter={() => setArrowHover(true)}
            onMouseLeave={() => setArrowHover(false)}
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              background: arrowHover ? '#1d4ed8' : 'rgba(29, 78, 216, 0.4)',
              border: arrowHover ? '1px solid #1e3a8a' : '1px solid rgba(29, 78, 216, 0.25)',
              color: 'white',
              cursor: 'pointer',
              boxShadow: arrowHover ? '0 2px 6px rgba(29,78,216,0.3)' : 'none',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              lineHeight: 1
            }}
            title="Extract to active canvas"
          >
            →
          </button>
        </div>
      )}
    </span>
  );
};