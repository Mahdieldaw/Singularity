/**
 * HTOS DNR Utilities
 * - Provides scoped and temporary DNR rule management
 * - Implements provider prerequisite gates
 * - Ensures minimal blast radius for network modifications
 *
 * Build-phase safe: emitted to dist/core/*
 */

export class DNRUtils {
  static scopedRules = new Map();
  static sessionRules = new Map();
  static ruleIdCounter = 10000; // Start high to avoid conflicts
  static debugEnabled = false;
  static debugListener = null;
  static cleanupInterval = null;
  static initialized = false;
  static STORAGE_KEY = 'dnr_rules_backup';

  /** Register a tab-scoped DNR rule */
  static async registerTabScoped(tabId, rule, providerId) {
    const ruleId = this.ruleIdCounter++;
    const fullRule = { ...rule, id: ruleId, condition: { ...rule.condition, tabIds: [tabId] } };
    try {
      await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [fullRule] });
      this.scopedRules.set(ruleId, { id: ruleId, tabId, providerId, rule: fullRule });
      // Persist updated counter and rule tracking so SW restarts do not collide IDs
      try { await this.persistRules(); } catch (e) { console.warn('DNR: persist after registerTabScoped failed', e); }
      console.debug(`DNR: Registered tab-scoped rule ${ruleId} for tab ${tabId}`, providerId ? `(${providerId})` : '');
      return ruleId;
    } catch (error) {
      console.error('Failed to register tab-scoped DNR rule:', error);
      throw error;
    }
  }

  /** Register a temporary DNR rule with auto-expiration */
  static async registerTemporary(rule, durationMs, providerId) {
    const ruleId = this.ruleIdCounter++;
    const fullRule = { ...rule, id: ruleId };
    const expiresAt = Date.now() + durationMs;
    try {
      await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [fullRule] });
      this.scopedRules.set(ruleId, { id: ruleId, expiresAt, providerId, rule: fullRule });
      // Persist updated counter and rule tracking so SW restarts do not collide IDs
      try { await this.persistRules(); } catch (e) { console.warn('DNR: persist after registerTemporary failed', e); }
      // Schedule automatic removal
      setTimeout(() => {
        this.removeRule(ruleId).catch(err => console.warn(`Failed to auto-remove expired DNR rule ${ruleId}:`, err));
      }, durationMs);
      console.debug(`DNR: Registered temporary rule ${ruleId} (expires in ${durationMs}ms)`, providerId ? `(${providerId})` : '');
      return ruleId;
    } catch (error) {
      console.error('Failed to register temporary DNR rule:', error);
      throw error;
    }
  }



  /** Clean up expired rules */
  static async cleanupExpiredRules() {
    const now = Date.now();
    
    // Check expired dynamic rules
    const expiredDynamicRules = Array.from(this.scopedRules.values()).filter(rule => rule.expiresAt && rule.expiresAt <= now);
    
    // Check expired session rules
    const expiredSessionRules = Array.from(this.sessionRules.values()).filter(rule => rule.expiresAt && rule.expiresAt <= now);
    
    const totalExpired = expiredDynamicRules.length + expiredSessionRules.length;
    if (totalExpired === 0) return;
    
    try {
      // Clean up expired dynamic rules
      if (expiredDynamicRules.length > 0) {
        const dynamicRuleIds = expiredDynamicRules.map(rule => rule.id);
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: dynamicRuleIds });
        dynamicRuleIds.forEach(id => this.scopedRules.delete(id));
      }
      
      // Clean up expired session rules
      if (expiredSessionRules.length > 0) {
        const sessionRuleIds = expiredSessionRules.map(rule => rule.id);
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: sessionRuleIds });
        sessionRuleIds.forEach(id => this.sessionRules.delete(id));
      }
      
      console.debug(`DNR: Cleaned up ${totalExpired} expired rules (${expiredDynamicRules.length} dynamic, ${expiredSessionRules.length} session)`);
    } catch (error) {
      console.error('Failed to cleanup expired DNR rules:', error);
    }
  }


  /** Register a header modification rule */
  static async registerHeaderRule({ tabId, urlFilter, resourceTypes, headerName, headerValue, operation = 'set', providerId, ruleId, durationMs }) {
    const finalRuleId = ruleId || this.ruleIdCounter++;
    const isTabScoped = !!tabId;
    const isTemporary = !!durationMs;
    
    const rule = {
      id: finalRuleId,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
        requestHeaders: [{
          header: headerName,
          operation: chrome.declarativeNetRequest.HeaderOperation[operation.toUpperCase()],
          value: headerValue
        }]
      },
      condition: {
        urlFilter: urlFilter,
        resourceTypes: resourceTypes || [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST],
        ...(isTabScoped && { tabIds: [tabId] })
      }
    };

    try {
      // Use session rules for tab-scoped or temporary rules, dynamic rules for persistent ones
      const useSessionRules = isTabScoped || isTemporary;
      
      if (useSessionRules) {
        await chrome.declarativeNetRequest.updateSessionRules({ addRules: [rule] });
        this.sessionRules.set(finalRuleId, {
          id: finalRuleId,
          tabId,
          providerId,
          rule,
          expiresAt: isTemporary ? Date.now() + durationMs : null,
          isTemporary
        });
      } else {
        await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [rule] });
        this.scopedRules.set(finalRuleId, {
          id: finalRuleId,
          tabId,
          providerId,
          rule
        });
      }

      // Persist rules for service worker restart recovery
      await this.persistRules();

      console.debug(`DNR: Registered header rule ${finalRuleId} for ${headerName}=${headerValue}`, 
        `(${useSessionRules ? 'session' : 'dynamic'}, ${providerId || 'no-provider'})`);
      
      // Schedule cleanup for temporary rules
      if (isTemporary) {
        setTimeout(() => {
          this.removeRule(finalRuleId).catch(err => 
            console.warn(`Failed to auto-remove expired header rule ${finalRuleId}:`, err));
        }, durationMs);
      }
      
      return finalRuleId;
    } catch (error) {
      console.error('Failed to register header modification rule:', error);
      throw error;
    }
  }

  /** Register a temporary header modification rule with auto-expiration */
  static async registerTemporaryHeaderRule({ tabId, urlFilter, resourceTypes, headerName, headerValue, operation = 'set', providerId, ruleId }, durationMs) {
    return this.registerHeaderRule({
      tabId,
      urlFilter,
      resourceTypes,
      headerName,
      headerValue,
      operation,
      providerId,
      ruleId,
      durationMs
    });
  }

  /** Remove a DNR rule by ID */
  static async removeRule(ruleId) {
    const scopedRule = this.scopedRules.get(ruleId);
    const sessionRule = this.sessionRules.get(ruleId);
    
    if (!scopedRule && !sessionRule) {
      console.warn(`DNR: Rule ${ruleId} not found in tracked rules`);
      return;
    }

    try {
      if (sessionRule) {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
        this.sessionRules.delete(ruleId);
      } else {
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [ruleId] });
        this.scopedRules.delete(ruleId);
      }
      
      // Persist updated rules
      await this.persistRules();
      
      console.debug(`DNR: Removed rule ${ruleId}`);
    } catch (error) {
      console.error(`Failed to remove DNR rule ${ruleId}:`, error);
      throw error;
    }
  }

  /** Remove all rules for a specific provider */
  static async removeProviderRules(providerId) {
    const dynamicProviderRules = Array.from(this.scopedRules.values()).filter(rule => rule.providerId === providerId);
    const sessionProviderRules = Array.from(this.sessionRules.values()).filter(rule => rule.providerId === providerId);
    
    const dynamicRuleIds = dynamicProviderRules.map(rule => rule.id);
    const sessionRuleIds = sessionProviderRules.map(rule => rule.id);
    
    try {
      if (dynamicRuleIds.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: dynamicRuleIds });
        dynamicRuleIds.forEach(id => this.scopedRules.delete(id));
      }
      
      if (sessionRuleIds.length > 0) {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: sessionRuleIds });
        sessionRuleIds.forEach(id => this.sessionRules.delete(id));
      }
      
      const totalRemoved = dynamicRuleIds.length + sessionRuleIds.length;
      if (totalRemoved > 0) {
        // Persist updated rules
        await this.persistRules();
        console.debug(`DNR: Removed ${totalRemoved} rules for provider ${providerId}`);
      }
    } catch (error) {
      console.error(`Failed to remove provider rules for ${providerId}:`, error);
      throw error;
    }
  }

  /** Get all active rules (both dynamic and session) */
  static async getActiveRules() {
    try {
      const [dynamicRules, sessionRules] = await Promise.all([
        chrome.declarativeNetRequest.getDynamicRules().catch(() => []),
        chrome.declarativeNetRequest.getSessionRules().catch(() => [])
      ]);
      
      return {
        dynamic: dynamicRules,
        session: sessionRules,
        tracked: {
          dynamic: Array.from(this.scopedRules.values()),
          session: Array.from(this.sessionRules.values())
        }
      };
    } catch (error) {
      console.error('Failed to get active DNR rules:', error);
      return {
        dynamic: [],
        session: [],
        tracked: {
          dynamic: Array.from(this.scopedRules.values()),
          session: Array.from(this.sessionRules.values())
        }
      };
    }
  }

  /** Enable debug mode with rule match logging */
  static enableDebugMode() {
    if (this.debugEnabled) {
      console.debug('DNR: Debug mode already enabled');
      return;
    }
    
    if (!chrome.declarativeNetRequest?.onRuleMatchedDebug) {
      console.warn('DNR: onRuleMatchedDebug not available - debug mode requires developer mode');
      return;
    }
    
    this.debugListener = (info) => {
      console.debug('DNR Rule Match:', {
        ruleId: info.rule.ruleId,
        tabId: info.request.tabId,
        url: info.request.url,
        method: info.request.method,
        resourceType: info.request.type,
        action: info.rule.action,
        timestamp: new Date().toISOString()
      });
    };
    
    chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(this.debugListener);
    this.debugEnabled = true;
    console.debug('DNR: Debug mode enabled');
  }

  /** Disable debug mode */
  static disableDebugMode() {
    if (!this.debugEnabled) {
      console.debug('DNR: Debug mode already disabled');
      return;
    }
    
    if (this.debugListener && chrome.declarativeNetRequest?.onRuleMatchedDebug) {
      chrome.declarativeNetRequest.onRuleMatchedDebug.removeListener(this.debugListener);
    }
    
    this.debugListener = null;
    this.debugEnabled = false;
    console.debug('DNR: Debug mode disabled');
  }

  /** Start periodic cleanup of expired rules */
  static startPeriodicCleanup(intervalMs = 5 * 60 * 1000) { // 5 minutes default
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredRules().catch(err => 
        console.warn('Periodic DNR cleanup failed:', err));
    }, intervalMs);
    
    console.debug('DNR: Started periodic cleanup');
  }

  /** Stop periodic cleanup */
  static stopPeriodicCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.debug('DNR: Stopped periodic cleanup');
    }
  }

  /** Initialize DNR utils and restore persisted rules */
  static async initialize() {
    if (this.initialized) return;
    
    try {
      // Restore rules from storage
      await this.restorePersistedRules();
      
      // Start periodic cleanup
      this.startPeriodicCleanup();
      
      this.initialized = true;
      console.debug('DNR: Initialized successfully');
    } catch (error) {
      console.error('DNR: Initialization failed:', error);
    }
  }

  /** Persist rules to storage for service worker restart recovery */
  static async persistRules() {
    try {
      const rulesData = {
        scopedRules: Array.from(this.scopedRules.entries()),
        sessionRules: Array.from(this.sessionRules.entries()),
        ruleIdCounter: this.ruleIdCounter,
        timestamp: Date.now()
      };
      
      await chrome.storage.local.set({ [this.STORAGE_KEY]: rulesData });
    } catch (error) {
      console.warn('DNR: Failed to persist rules:', error);
    }
  }

  /** Restore rules from storage after service worker restart */
  static async restorePersistedRules() {
    try {
      const result = await chrome.storage.local.get(this.STORAGE_KEY);
      const rulesData = result[this.STORAGE_KEY];
      
      if (!rulesData) return;
      
      // Restore rule counter
      if (rulesData.ruleIdCounter) {
        this.ruleIdCounter = Math.max(this.ruleIdCounter, rulesData.ruleIdCounter);
      }
      
      // Restore scoped rules
      if (rulesData.scopedRules) {
        this.scopedRules = new Map(rulesData.scopedRules);
      }
      
      // Restore session rules
      if (rulesData.sessionRules) {
        this.sessionRules = new Map(rulesData.sessionRules);
      }
      
      // Clean up expired rules immediately
      await this.cleanupExpiredRules();
      
      console.debug('DNR: Restored persisted rules');
    } catch (error) {
      console.warn('DNR: Failed to restore persisted rules:', error);
    }
  }

  /** Clear persisted rules from storage */
  static async clearPersistedRules() {
    try {
      await chrome.storage.local.remove(this.STORAGE_KEY);
      console.debug('DNR: Cleared persisted rules');
    } catch (error) {
      console.warn('DNR: Failed to clear persisted rules:', error);
    }
  }
}

/** Provider DNR Prerequisite Gate */
export class ProviderDNRGate {
  static providerRules = new Map();

  /** Ensure provider prerequisites are met before network operations */
  static async ensureProviderDnrPrereqs(providerId, tabId) {
    console.debug(`DNR Gate: Ensuring prerequisites for ${providerId}`);
    const rules = this.getProviderRules(providerId);
    if (rules.length === 0) {
      console.debug(`DNR Gate: No prerequisites needed for ${providerId}`);
      return;
    }
    const ruleIds = [];
    try {
      for (const rule of rules) {
        let ruleId;
        if (tabId) {
          // Tab-scoped rule
          ruleId = await DNRUtils.registerTabScoped(tabId, rule, providerId);
        } else {
          // Temporary global rule (5 minutes max)
          ruleId = await DNRUtils.registerTemporary(rule, 5 * 60 * 1000, providerId);
        }
        ruleIds.push(ruleId);
      }
      const existingRules = this.providerRules.get(providerId) || [];
      this.providerRules.set(providerId, [...existingRules, ...ruleIds]);
      console.debug(`DNR Gate: Activated ${ruleIds.length} rules for ${providerId}`);
    } catch (error) {
      for (const ruleId of ruleIds) {
        await DNRUtils.removeRule(ruleId).catch(() => {});
      }
      throw error;
    }
  }

  /** Clean up provider rules after workflow completion */
  static async cleanupProviderRules(providerId) {
    await DNRUtils.removeProviderRules(providerId);
    this.providerRules.delete(providerId);
  }

  /** Get provider-specific DNR rules */
  static getProviderRules(providerId) {
    switch (providerId) {
      case 'claude':
        return [
          {
            priority: 1,
            action: {
              type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
              responseHeaders: [
                { header: 'content-security-policy', operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE }
              ]
            },
            condition: { urlFilter: '*://claude.ai/*', resourceTypes: [chrome.declarativeNetRequest.ResourceType.SUB_FRAME] }
          }
        ];
      case 'gemini':
        return [
          {
            priority: 1,
            action: {
              type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
              responseHeaders: [
                { header: 'x-frame-options', operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE }
              ]
            },
            condition: { urlFilter: '*://gemini.google.com/*', resourceTypes: [chrome.declarativeNetRequest.ResourceType.SUB_FRAME] }
          }
        ];
      case 'qwen':
        return [
          {
            priority: 1,
            action: {
              type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
              requestHeaders: [
                {
                  header: 'origin',
                  operation: chrome.declarativeNetRequest.HeaderOperation.SET,
                  value: 'https://www.tongyi.com'
                },
                {
                  header: 'referer',
                  operation: chrome.declarativeNetRequest.HeaderOperation.SET,
                  value: 'https://www.tongyi.com/'
                }
              ]
            },
            condition: {
              requestDomains: ["qianwen.aliyun.com", "api.tongyi.com"],
              resourceTypes: [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST]
            }
          }
        ];
      default:
        return [];
    }
  }
}
