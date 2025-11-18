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
  private readonly MAX_CHUNKS_PER_PROVIDER = 500;
  private chunkCounts: Map<string, number> = new Map();

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
      this.chunkCounts.set(key, 0);
    }

    const entry = this.pendingDeltas.get(key)!;
    entry.deltas.push({ text: delta, ts: Date.now() });
    entry.status = status;
    entry.responseType = responseType;

    const count = (this.chunkCounts.get(key) || 0) + 1;
    this.chunkCounts.set(key, count);
    if (count >= this.MAX_CHUNKS_PER_PROVIDER) {
      this.flushImmediate();
      return;
    }

    this.scheduleBatchFlush();
  }

  private scheduleBatchFlush() {
    if (this.flushTimer !== null) return;
    this.flushTimer = window.requestAnimationFrame(() => {
      this.flushAll();
      this.flushTimer = null;
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
    this.chunkCounts.clear();

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
    this.chunkCounts.clear();
  }

  getMemoryStats() {
    let totalChunks = 0;
    let totalBytes = 0;
    this.pendingDeltas.forEach((entry) => {
      totalChunks += entry.deltas.length;
      entry.deltas.forEach((d) => {
        totalBytes += (d.text?.length || 0) * 2;
      });
    });
    return {
      providers: this.pendingDeltas.size,
      totalChunks,
      totalBytes,
      estimatedMB: Number((totalBytes / 1024 / 1024).toFixed(2)),
    };
  }
}
