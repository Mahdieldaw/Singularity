/**
 * HTOS Lifecycle Manager - Minimal & Persistent
 *
 * Strategy: Keep SW alive as long as there's been ANY activity in the last 20 minutes.
 * This prevents shutdown during normal usage patterns while allowing true idle cleanup.
 */

export class LifecycleManager {
  constructor(ping) {
    this.ping = ping;
    this.lastActivity = Date.now();
    this.heartbeatTimer = null;
    this.heartbeatIntervalMs = 25000; // Ping every 25s (below 30s threshold)
    this.INACTIVITY_THRESHOLD = 20 * 60 * 1000; // 20 minutes
    this.ALARM_NAME = "htos-heartbeat";
  }

  /**
   * Called whenever ANY activity happens (workflow, message, etc)
   */
  recordActivity() {
    this.lastActivity = Date.now();

    // Start heartbeat if not running
    if (!this.heartbeatTimer) {
      try {
        console.log("[Lifecycle] Activity detected, starting heartbeat");
      } catch (e) {}
      this.startHeartbeat();
    }
  }

  /**
   * Start persistent heartbeat
   */
  startHeartbeat() {
    if (this.heartbeatTimer) return;

    if (typeof chrome !== "undefined" && chrome.alarms) {
      this.startAlarmBasedHeartbeat();
    } else {
      this.startTimerBasedHeartbeat();
    }
  }

  startAlarmBasedHeartbeat() {
    try {
      chrome.alarms.clear(this.ALARM_NAME);

      // Ensure we don't add duplicate listeners in some environments
      if (chrome.alarms && chrome.alarms.onAlarm && !this._alarmListener) {
        this._alarmListener = (alarm) => {
          if (alarm && alarm.name === this.ALARM_NAME) {
            this.executePing();
          }
        };
        chrome.alarms.onAlarm.addListener(this._alarmListener);
      }

      const periodMinutes = Math.max(
        0.016,
        this.heartbeatIntervalMs / (1000 * 60),
      );
      chrome.alarms.create(this.ALARM_NAME, {
        delayInMinutes: periodMinutes,
        periodInMinutes: periodMinutes,
      });

      this.heartbeatTimer = 1;
      // Immediate first ping
      this.executePing();
    } catch (e) {
      // Fallback to timer-based if alarms fail
      try {
        this.startTimerBasedHeartbeat();
      } catch (_) {}
    }
  }

  startTimerBasedHeartbeat() {
    const tick = async () => {
      await this.executePing();
      this.heartbeatTimer = setTimeout(tick, this.heartbeatIntervalMs);
    };

    // kick off immediately
    this.heartbeatTimer = setTimeout(tick, 0);
  }

  async executePing() {
    try {
      const timeSinceActivity = Date.now() - this.lastActivity;

      // Stop heartbeat if truly inactive for threshold
      if (timeSinceActivity > this.INACTIVITY_THRESHOLD) {
        try {
          console.log(
            "[Lifecycle] No activity for threshold, allowing SW shutdown",
          );
        } catch (e) {}
        this.stopHeartbeat();
        return;
      }

      if (this.ping) {
        await this.ping();
      } else if (typeof chrome !== "undefined" && chrome.runtime?.id) {
        try {
          const res = chrome.runtime.sendMessage({ type: "htos.keepalive" });
          // Some chrome implementations return a Promise; guard it
          if (res && typeof res.then === "function") {
            await res.catch(() => {});
          }
        } catch (e) {
          // best-effort
        }
      }
    } catch (e) {
      // Non-fatal
      try {
        console.warn("LifecycleManager ping error", e);
      } catch (err) {}
    }
  }

  stopHeartbeat() {
    try {
      if (typeof chrome !== "undefined" && chrome.alarms) {
        chrome.alarms.clear(this.ALARM_NAME);
        if (
          this._alarmListener &&
          chrome.alarms &&
          chrome.alarms.onAlarm &&
          chrome.alarms.onAlarm.removeListener
        ) {
          try {
            chrome.alarms.onAlarm.removeListener(this._alarmListener);
          } catch (e) {}
          this._alarmListener = null;
        }
      } else if (this.heartbeatTimer) {
        clearTimeout(this.heartbeatTimer);
      }
    } catch (e) {
      // ignore
    }

    this.heartbeatTimer = null;
  }

  /**
   * Explicit workflow mode controls (backward compatible)
   */
  activateWorkflowMode() {
    this.recordActivity();
  }

  deactivateWorkflowMode() {
    this.recordActivity();
  }

  /**
   * Legacy keepalive API (backward compatible)
   */
  keepalive(enable) {
    if (enable) {
      this.recordActivity();
    }
    // Never stop on disable - let inactivity threshold handle it
  }
}
