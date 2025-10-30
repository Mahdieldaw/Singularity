import React, { useMemo } from 'react';
import type { ChatTurn, ResponseBlock } from '../../types/chat';
import { DraggableSegment } from './DraggableSegment';
import { Granularity, segmentText } from '../../utils/segmentText';
import { ProvenanceData } from './extensions/ComposedContentNode';
// Removed provider header badge; no longer need provider registry here

interface ResponseViewerProps {
  turn: ChatTurn | null;
  response?: ResponseBlock | undefined;
  granularity: Granularity; // kept for compatibility but enforced to 'paragraph'
  onGranularityChange: (g: Granularity) => void; // no-op in UI (sentence removed)
  onPinSegment?: (text: string, provenance: ProvenanceData) => void;
  onExtractToCanvas?: (text: string, provenance: ProvenanceData) => void;
}

export const ResponseViewer: React.FC<ResponseViewerProps> = ({
  turn,
  response,
  granularity,
  onGranularityChange,
  onPinSegment,
  onExtractToCanvas,
}) => {
  // Determine effective response to display
  const effectiveResponse = useMemo<ResponseBlock | undefined>(() => {
    if (!turn) return undefined;
    if (turn.type === 'user') return undefined;
    if (response && (turn.responses || []).some(r => r.id === response.id)) return response;
    return turn.responses?.[0];
  }, [turn, response]);

  const text = useMemo(() => {
    if (!turn) return '';
    if (turn.type === 'user') return turn.content || '';
    return effectiveResponse?.content || '';
  }, [turn, effectiveResponse]);

  const providerIdFull = useMemo(() => {
    if (!turn || turn.type === 'user') return 'user';
    return effectiveResponse?.providerId || turn.providerId || 'unknown';
  }, [turn, effectiveResponse]);

  const responseType: ProvenanceData['responseType'] = useMemo(() => {
    if (/-synthesis$/.test(providerIdFull)) return 'synthesis';
    if (/-mapping$/.test(providerIdFull)) return 'mapping';
    return 'batch';
  }, [providerIdFull]);
  const responseIndex = useMemo(() => {
    if (!turn || turn.type === 'user') return 0;
    const idx = (turn.responses || []).findIndex(r => r.id === effectiveResponse?.id);
    return idx >= 0 ? idx : 0;
  }, [turn, effectiveResponse]);

  // Map UI granularity to provenance granularity union
  // Enforce paragraph granularity for provenance
  const provGranularity: ProvenanceData['granularity'] = useMemo(() => {
    return 'paragraph';
  }, []);

  const provenance: ProvenanceData = useMemo(() => ({
    sessionId: turn?.sessionId || 'current',
    aiTurnId: turn?.id || 'unknown',
    providerId: providerIdFull,
    responseType,
    responseIndex,
    timestamp: Date.now(),
    granularity: provGranularity,
    sourceText: text,
    sourceContext: { fullResponse: text }
  }), [turn, providerIdFull, responseType, responseIndex, provGranularity, text]);

  // Always segment by paragraph
  const segments = useMemo(() => segmentText(text, 'paragraph'), [text]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Content area only (header removed as redundant; single granularity) */}
      <div style={{
        position: 'relative',
        overflow: 'visible',
        flex: 1,
        minHeight: 0,
        background: '#0b1220',
        borderRadius: 8
      }}>
        <div style={{
          overflow: 'auto',
          height: '100%',
          padding: 16
        }}>
          {segments.length === 0 && (
            <div style={{ color: '#94a3b8', fontSize: 13 }}>No content available.</div>
          )}
          {segments.map(seg => (
            <DraggableSegment
              key={seg.id}
              segment={seg}
              turnId={turn?.id || 'unknown'}
              responseId={effectiveResponse?.id || `${turn?.id}-primary`}
              providerId={providerIdFull}
              granularity={'paragraph'}
              provenance={provenance}
              sourceContext={{ fullResponse: text }}
              onPin={onPinSegment}
              onExtractToCanvas={onExtractToCanvas}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default ResponseViewer;