import { ProvenanceData } from '../components/composer/extensions/ComposedContentNode';

export interface GhostData {
  id: string;
  text: string;
  preview: string;
  provenance: ProvenanceData;
  createdAt: number;
  isPinned: boolean;
}

export interface DragData {
  type: 'content-block' | 'response' | 'turn';
  content: string;
  provenance: ProvenanceData;
  metadata: {
    turnId: string;
    responseId?: string;
    blockId?: string;
    providerId: string;
    timestamp: string;
    granularity: 'paragraph' | 'sentence' | 'phrase' | 'word' | 'response' | 'turn';
    sourceContext?: {
      beforeText?: string;
      afterText?: string;
      fullResponse?: string;
    };
  };
}

export interface DropTarget {
  type: 'canvas' | 'timeline' | 'focus-pane';
  position?: {
    x: number;
    y: number;
  };
  insertionPoint?: {
    beforeNode?: string;
    afterNode?: string;
    atEnd?: boolean;
  };
}

export interface DragDropContext {
  isDragging: boolean;
  dragData?: DragData;
  dropTarget?: DropTarget;
  onDragStart: (data: DragData) => void;
  onDragEnd: () => void;
  onDrop: (data: DragData, target: DropTarget) => void;
}

// Utility functions for creating drag data
export const createContentBlockDragData = (
  content: string,
  provenance: ProvenanceData,
  turnId: string,
  responseId: string,
  blockId: string,
  providerId: string,
  granularity: DragData['metadata']['granularity'] = 'paragraph',
  sourceContext?: DragData['metadata']['sourceContext']
): DragData => ({
  type: 'content-block',
  content,
  provenance,
  metadata: {
    turnId,
    responseId,
    blockId,
    providerId,
    timestamp: new Date().toISOString(),
    granularity,
    sourceContext
  }
});

export const createResponseDragData = (
  content: string,
  provenance: ProvenanceData,
  turnId: string,
  responseId: string,
  providerId: string,
  sourceContext?: DragData['metadata']['sourceContext']
): DragData => ({
  type: 'response',
  content,
  provenance,
  metadata: {
    turnId,
    responseId,
    providerId,
    timestamp: new Date().toISOString(),
    granularity: 'response',
    sourceContext
  }
});

export const createTurnDragData = (
  content: string,
  provenance: ProvenanceData,
  turnId: string,
  providerId: string,
  sourceContext?: DragData['metadata']['sourceContext']
): DragData => ({
  type: 'turn',
  content,
  provenance,
  metadata: {
    turnId,
    providerId,
    timestamp: new Date().toISOString(),
    granularity: 'turn',
    sourceContext
  }
});

// Validation functions
export const isValidDragData = (data: any): data is DragData => {
  return (
    data &&
    typeof data === 'object' &&
    ['content-block', 'response', 'turn'].includes(data.type) &&
    typeof data.content === 'string' &&
    data.provenance &&
    data.metadata &&
    typeof data.metadata.turnId === 'string' &&
    typeof data.metadata.providerId === 'string' &&
    typeof data.metadata.timestamp === 'string' &&
    ['paragraph', 'sentence', 'phrase', 'word', 'response', 'turn'].includes(data.metadata.granularity)
  );
};

export const isValidDropTarget = (target: any): target is DropTarget => {
  return (
    target &&
    typeof target === 'object' &&
    ['canvas', 'timeline', 'focus-pane'].includes(target.type)
  );
};