// src/ui/services/extension-api.ts
// Streamlined API with document & ghost helpers + hardened queryBackend

import {
  EXECUTE_WORKFLOW,
  GET_FULL_HISTORY,
  GET_HISTORY_SESSION,
  DELETE_SESSION,
  GET_SYSTEM_STATUS,
} from "../../shared/messaging";

import type { HistorySessionSummary, HistoryApiResponse } from "../types";
import type { ExecuteWorkflowRequest } from "../../shared/contract";
import { PortHealthManager } from './port-health-manager';
import type { DocumentRecord } from '../types';

interface BackendApiResponse<T = any> {
  success: boolean;
  data?: T;
  // Some handlers return fields at top-level (e.g. { success: true, documents: [...] })
  [key: string]: any;
}

let EXTENSION_ID: string | null = null;

class ExtensionAPI {
  private portHealthManager: PortHealthManager | null = null;
  private connectionStateCallbacks: Set<(connected: boolean) => void> = new Set();
  private sessionId: string | null = null;
  private port: chrome.runtime.Port | null = null;
  private portMessageHandler: ((message: any) => void) | null = null;

  constructor() {
    this.portHealthManager = new PortHealthManager('htos-popup', {
      onHealthy: () => this.notifyConnectionState(true),
      onUnhealthy: () => this.notifyConnectionState(false),
      onReconnect: () => this.notifyConnectionState(true),
    });
  }

  onConnectionStateChange(callback: (connected: boolean) => void): () => void {
    this.connectionStateCallbacks.add(callback);
    return () => this.connectionStateCallbacks.delete(callback);
  }

  private notifyConnectionState(connected: boolean) {
    this.connectionStateCallbacks.forEach(cb => {
      try { cb(connected); } catch (e) { console.error('[ExtensionAPI] Connection state callback error:', e); }
    });
  }

  getConnectionStatus() {
    return this.portHealthManager?.getStatus() || {
      isConnected: !!this.port,
      reconnectAttempts: 0,
      lastPongTimestamp: 0,
      timeSinceLastPong: Infinity
    };
  }

  checkHealth() {
    this.portHealthManager?.checkHealth();
  }

  setExtensionId(id: string): void {
    if (!EXTENSION_ID) {
      EXTENSION_ID = id;
      console.log("[ExtensionAPI] setExtensionId:", EXTENSION_ID);
    }
  }

  async ensurePort(options: { sessionId?: string; force?: boolean } = {}): Promise<chrome.runtime.Port> {
    const { sessionId, force = false } = options;
    if (sessionId) this.sessionId = sessionId;

    if (this.port && !force) {
      const status = this.portHealthManager?.getStatus();
      if (status?.isConnected) return this.port;
    }

    if (this.portHealthManager && this.portMessageHandler) {
      this.port = this.portHealthManager.connect(
        (message) => { if (this.portMessageHandler) this.portMessageHandler(message); },
        () => { console.warn('[ExtensionAPI] Port disconnected'); this.port = null; }
      );
      return this.port;
    }

    // Fallback
    if (!EXTENSION_ID) throw new Error('Extension ID not set. Call setExtensionId() on startup.');
    this.port = chrome.runtime.connect(EXTENSION_ID, { name: 'htos-popup' });
    this.port.onMessage.addListener((message) => { if (this.portMessageHandler) this.portMessageHandler(message); });
    this.port.onDisconnect.addListener(() => { console.warn('[ExtensionAPI] Port disconnected (fallback)'); this.port = null; });
    return this.port;
  }

  setPortMessageHandler(handler: ((message: any) => void) | null): void {
    this.portMessageHandler = handler;
    console.log("[API] Port message handler registered.");
  }

  async executeWorkflow(request: ExecuteWorkflowRequest): Promise<void> {
    const port = await this.ensurePort({ sessionId: request.sessionId });
    this.portHealthManager?.checkHealth();
    return new Promise((resolve, reject) => {
      try {
        port.postMessage({
          type: EXECUTE_WORKFLOW,
          payload: request
        });
        resolve();
      } catch (error) {
        console.error('[ExtensionAPI] Failed to execute workflow:', error);
        // Try one reconnect attempt
        this.ensurePort({ force: true }).then(() => {
          try {
            this.port?.postMessage({ type: EXECUTE_WORKFLOW, payload: request });
            resolve();
          } catch (retryError) {
            reject(retryError);
          }
        }).catch(reject);
      }
    });
  }

    // ...
  /**
   * queryBackend: Robust handling for different SW response shapes
   * Accepts both { success: true, data: ... } and { success: true, <top-level fields>... }.
   */
  async queryBackend<T = any>(message: { type: string; [key: string]: any }): Promise<T> {
    if (!EXTENSION_ID) throw new Error("Extension not connected. Please call setExtensionId on startup or reload the extension.");

    return new Promise<T>((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(EXTENSION_ID as string, message, (response: BackendApiResponse<T> | null) => {
          if (chrome.runtime.lastError) {
            console.error("[API] Connection error:", chrome.runtime.lastError);
            return reject(new Error(`Extension connection failed: ${chrome.runtime.lastError.message}. Try reloading the extension.`));
          }

          if (!response) {
            console.error("[API] Empty response received for", message.type);
            return reject(new Error("No response from extension. The service worker may be inactive."));
          }

          if (response?.success) {
            if (response.data !== undefined) {
              return resolve(response.data as T);
            }
            const copy: any = { ...response };
            delete copy.success;
            delete copy.error;
            const keys = Object.keys(copy);
            if (keys.length === 1) {
              return resolve(copy[keys[0]] as T);
            }
            return resolve(copy as T);
          }

          console.error("[API] Backend error for", message.type, ":", response?.error);
          const errMsg = response?.error?.message || (response as any)?.error || "Unknown backend error. See extension logs.";
          return reject(new Error(errMsg));
        });
      } catch (err) {
        console.error("[API] Fatal extension error:", err);
        reject(new Error(`Extension communication error: ${err instanceof Error ? err.message : String(err)}`));
      }
    });
  }

  // === DATA & SESSION METHODS ===
  getHistoryList(): Promise<HistoryApiResponse> {
    return this.queryBackend<HistoryApiResponse>({ type: GET_FULL_HISTORY });
  }

  getHistorySession(sessionId: string): Promise<HistorySessionSummary> {
    return this.queryBackend<HistorySessionSummary>({ type: GET_HISTORY_SESSION, payload: { sessionId } });
  }

  deleteBackgroundSession(sessionId: string): Promise<{ removed: boolean }> {
    return this.queryBackend<{ removed: boolean }>({ type: DELETE_SESSION, payload: { sessionId } });
  }

  // === DOCUMENT & GHOST METHODS ===

  async saveDocument(doc: DocumentRecord): Promise<void> {
    await this.queryBackend<void>({
      type: 'SAVE_DOCUMENT',
      documentId: doc.id,
      document: doc,
      content: doc.canvasContent
    });
  }

  async loadDocument(id: string): Promise<DocumentRecord | null> {
    const response = await this.queryBackend<any>({
      type: 'LOAD_DOCUMENT',
      documentId: id,
      reconstructContent: true
    });
    // backend may return { document: ... } or document directly
    if (!response) return null;
    return response.document ?? response;
  }

  async listDocuments(): Promise<Array<{ id: string; title: string; lastModified: number }>> {
    const response = await this.queryBackend<{ documents?: any[] }>({
      type: 'LIST_DOCUMENTS'
    }).catch((e) => {
      console.error('[API] listDocuments failed:', e);
      return { documents: [] } as any;
    });
    return (response && (response.documents || response)) || [];
  }

  async deleteDocument(id: string): Promise<void> {
    await this.queryBackend<void>({ type: 'DELETE_DOCUMENT', documentId: id });
  }

  async createGhost(documentId: string, text: string, provenance: any): Promise<any> {
    const response = await this.queryBackend<{ ghost?: any }>({
      type: 'CREATE_GHOST',
      documentId,
      text,
      provenance
    });
    return response.ghost ?? response;
  }

  async getDocumentGhosts(documentId: string): Promise<any[]> {
    const response = await this.queryBackend<{ ghosts?: any[] }>({
      type: 'GET_DOCUMENT_GHOSTS',
      documentId
    }).catch((e) => {
      console.error('[API] getDocumentGhosts failed:', e);
      return { ghosts: [] } as any;
    });

    // Normalize to an array
    const ghosts = (response && (response.ghosts ?? response)) as any[];
    return ghosts || [];
  }
  


  async deleteGhost(ghostId: string): Promise<void> {
    await this.queryBackend<void>({ type: 'DELETE_GHOST', ghostId });
  }

  // deprecation & no-op helpers
  setSessionId(sessionId: string): void {
    console.log(`[API] setSessionId called for ${sessionId}, but sync is now implicit.`);
  }

  updateProviderContext(providerId: string, context: any): void {
    console.warn("`updateProviderContext` is deprecated. Context is managed by the backend.");
  }

  clearSession(sessionId: string): void {
    console.log(`Clearing UI-related state for session ${sessionId}`);
  }
}

const api = new ExtensionAPI();
export default api;
