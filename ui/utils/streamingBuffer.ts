// src/ui/utils/streamingBuffer.ts
type ResponseType = 'batch' | 'synthesis' | 'mapping';

interface BatchUpdate {
  providerId: string;
  text: string;
  status: string;
  responseType: ResponseType;
  createdAt: number;
}

export class StreamingBuffer {
  private pendingDeltas: Map<string, {
    deltas: { text: string; ts: number }[];
    status: string;
    responseType: ResponseType;
  }> = new Map();
  
  private flushTimer: number | null = null;
  private onFlushCallback: (updates: BatchUpdate[]) => void;

  constructor(onFlush: (updates: BatchUpdate[]) => void) {
    this.onFlushCallback = onFlush;
  }

  addDelta(providerId: string, delta: string, status: string, responseType: ResponseType) {
    if (!this.pendingDeltas.has(providerId)) {
      this.pendingDeltas.set(providerId, {
        deltas: [],
        status,
        responseType
      });
    }
    
    const entry = this.pendingDeltas.get(providerId)!;
    entry.deltas.push({ text: delta, ts: Date.now() });
    entry.status = status;
    entry.responseType = responseType;
    
    this.scheduleBatchFlush();
  }

  private scheduleBatchFlush() {
    // Cancel any pending flush
    if (this.flushTimer !== null) {
      cancelAnimationFrame(this.flushTimer);
    }
    
    // ⭐ DOUBLE-RAF PATTERN: First RAF schedules, second RAF executes after layout
    this.flushTimer = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        this.flushAll();
        this.flushTimer = null;
      });
    });
  }

  private flushAll() {
    const updates: BatchUpdate[] = [];
    
    this.pendingDeltas.forEach((entry, providerId) => {
      const concatenatedText = entry.deltas.map(d => d.text).join('');
      const lastTs = entry.deltas.length ? entry.deltas[entry.deltas.length - 1].ts : Date.now();
      updates.push({
        providerId,
        text: concatenatedText,
        status: entry.status,
        responseType: entry.responseType,
        createdAt: lastTs,
      });
    });
    
    this.pendingDeltas.clear();
    
    if (updates.length > 0) {
      updates.sort((a, b) => a.createdAt - b.createdAt);
      this.onFlushCallback(updates);
    }
  }

  flushImmediate() {
    if (this.flushTimer !== null) {
      cancelAnimationFrame(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushAll();
  }

  clear() {
    if (this.flushTimer !== null) {
      cancelAnimationFrame(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingDeltas.clear();
  }
}