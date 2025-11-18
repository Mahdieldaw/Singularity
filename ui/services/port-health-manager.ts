export class PortHealthManager {
  private port: chrome.runtime.Port | null = null;
  private healthCheckInterval: number | null = null;
  private reconnectTimeout: number | null = null;
  private messageHandler: ((msg: any) => void) | null = null;
  private onDisconnectCallback: (() => void) | undefined = undefined;

  // Relaxed health check and reconnect strategy to reduce churn
  private readonly HEALTH_CHECK_INTERVAL = 30000; // 30s
  private readonly RECONNECT_DELAY = 2000; // base delay
  private readonly RECONNECT_JITTER_MS = 500; // random jitter

  private reconnectAttempts = 0;
  private isConnected = false;
  private lastPongTimestamp = 0;

  constructor(
    private portName: string = "htos-popup",
    private options: {
      onHealthy?: () => void;
      onUnhealthy?: () => void;
      onReconnect?: () => void;
    } = {},
  ) {}

  connect(
    messageHandler: (msg: any) => void,
    onDisconnect?: () => void,
  ): chrome.runtime.Port {
    this.messageHandler = messageHandler;
    this.onDisconnectCallback = onDisconnect;

    this.port = chrome.runtime.connect({ name: this.portName });
    this.isConnected = true;
    this.reconnectAttempts = 0;

    this.port.onMessage.addListener(this.handleMessage.bind(this));
    this.port.onDisconnect.addListener(this.handleDisconnect.bind(this));

    this.startHealthCheck();

    console.log("[PortHealthManager] Connected to service worker");
    return this.port;
  }

  private sendKeepalivePing() {
    if (!this.port || !this.isConnected) return;

    try {
      this.port.postMessage({ type: "KEEPALIVE_PING", timestamp: Date.now() });
    } catch (error) {
      console.warn("[PortHealthManager] Failed to send keepalive ping:", error);
      this.handleUnhealthyPort();
    }
  }

  private startHealthCheck() {
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);

    this.healthCheckInterval = window.setInterval(() => {
      this.sendKeepalivePing();

      const timeSinceLastPong = Date.now() - this.lastPongTimestamp;
      // Be more tolerant before declaring unhealthy
      if (timeSinceLastPong > this.HEALTH_CHECK_INTERVAL * 3) {
        console.warn(
          "[PortHealthManager] No pong received, port may be unhealthy",
        );
        this.handleUnhealthyPort();
      }
    }, this.HEALTH_CHECK_INTERVAL);
  }

  private stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  private handleMessage(message: any) {
    // Any inbound traffic indicates the port is alive; update timestamp first
    this.lastPongTimestamp = Date.now();

    // Notify SW of activity so lifecycle manager can record activity (best-effort)
    try {
      if (
        chrome &&
        chrome.runtime &&
        typeof chrome.runtime.sendMessage === "function"
      ) {
        chrome.runtime.sendMessage(
          { type: "htos.activity", timestamp: Date.now() },
          () => {
            /* noop */
          },
        );
      }
    } catch (e) {}

    if (message.type === "KEEPALIVE_PONG") {
      if (!this.isConnected) {
        this.isConnected = true;
        console.log("[PortHealthManager] Port healthy again");
        this.options.onHealthy?.();
      }
      return;
    }

    if (message.type === "HANDLER_READY") {
      console.log("[PortHealthManager] Service worker handler ready");
      this.isConnected = true;
      return;
    }

    if (this.messageHandler) {
      this.messageHandler(message);
    }
  }

  private handleDisconnect() {
    console.warn("[PortHealthManager] Port disconnected");
    this.isConnected = false;
    this.stopHealthCheck();

    this.options.onUnhealthy?.();
    this.onDisconnectCallback?.();

    this.attemptReconnect();
  }

  private handleUnhealthyPort() {
    if (!this.isConnected) return;

    console.warn("[PortHealthManager] Port unhealthy, attempting reconnect");
    this.isConnected = false;
    this.options.onUnhealthy?.();

    this.disconnect();
    this.attemptReconnect();
  }

  private attemptReconnect() {
    this.reconnectAttempts++;
    const jitter = Math.floor(Math.random() * this.RECONNECT_JITTER_MS);
    const base = this.RECONNECT_DELAY + jitter;
    const delay = base * Math.pow(2, this.reconnectAttempts - 1);

    console.log(
      `[PortHealthManager] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`,
    );

    this.reconnectTimeout = window.setTimeout(() => {
      if (this.messageHandler) {
        this.connect(this.messageHandler, this.onDisconnectCallback);
        this.options.onReconnect?.();
      }
    }, delay);
  }

  disconnect() {
    this.isConnected = false;
    this.stopHealthCheck();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.port) {
      try {
        this.port.disconnect();
      } catch (e) {}
      this.port = null;
    }
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      lastPongTimestamp: this.lastPongTimestamp,
      timeSinceLastPong: Date.now() - this.lastPongTimestamp,
    };
  }

  checkHealth() {
    this.sendKeepalivePing();
  }
}
