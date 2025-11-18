// src/ui/utils/streamingBuffer.ts
type ResponseType = "batch" | "synthesis" | "mapping";

interface BatchUpdate {
  providerId: string;
  text: string;
  status: string;
  responseType: ResponseType;
  createdAt: number;
}

export class StreamingBuffer {
  // Keyed by `${responseType}:${providerId}` to avoid collisions across types
  private pendingDeltas: Map<
    string,
    {
      deltas: { text: string; ts: number }[];
      status: string;
      responseType: ResponseType;
    }
  > = new Map();

  private flushTimer: number | null = null;
  private onFlushCallback: (updates: BatchUpdate[]) => void;

  constructor(onFlush: (updates: BatchUpdate[]) => void) {
    this.onFlushCallback = onFlush;
  }

  addDelta(
    providerId: string,
    delta: string,
    status: string,
    responseType: ResponseType,
  ) {
    const key = `${responseType}:${providerId}`;
    if (!this.pendingDeltas.has(key)) {
      this.pendingDeltas.set(key, {
        deltas: [],
        status,
        responseType,
      });
    }

    const entry = this.pendingDeltas.get(key)!;
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

    this.pendingDeltas.forEach((entry, compositeKey) => {
      const idx = compositeKey.indexOf(":");
      const providerId = idx >= 0 ? compositeKey.slice(idx + 1) : compositeKey;
      const concatenatedText = entry.deltas.map((d) => d.text).join("");
      const lastTs = entry.deltas.length
        ? entry.deltas[entry.deltas.length - 1].ts
        : Date.now();
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
