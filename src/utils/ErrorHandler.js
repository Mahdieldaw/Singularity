/**
 * HTOS Error Handler with Fallback Mechanisms
 * Provides comprehensive error handling, recovery strategies, and fallback mechanisms
 */

import { persistenceMonitor } from '../debug/PersistenceMonitor.js';

export class HTOSError extends Error {
    constructor(message, code, context = {}, recoverable = true) {
        super(message);
        this.name = 'HTOSError';
        this.code = code;
        this.context = context;
        this.recoverable = recoverable;
        this.timestamp = Date.now();
        this.id = `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            message: this.message,
            code: this.code,
            context: this.context,
            recoverable: this.recoverable,
            timestamp: this.timestamp,
            stack: this.stack
        };
    }
}

export class ErrorHandler {
    constructor() {
        this.fallbackStrategies = new Map();
        this.retryPolicies = new Map();
        this.errorCounts = new Map();
        this.circuitBreakers = new Map();
        
        this.setupDefaultStrategies();
        this.setupDefaultRetryPolicies();
    }

    /**
     * Setup default fallback strategies
     */
    setupDefaultStrategies() {
        // IndexedDB fallback to localStorage
        this.fallbackStrategies.set('INDEXEDDB_UNAVAILABLE', async (operation, context) => {
            console.warn('🔄 Falling back to localStorage for:', operation);
            
            try {
                switch (operation) {
                    case 'save':
                        return this.saveToLocalStorage(context.key, context.data);
                    case 'load':
                        return this.loadFromLocalStorage(context.key);
                    case 'delete':
                        return this.deleteFromLocalStorage(context.key);
                    case 'list':
                        return this.listFromLocalStorage(context.prefix);
                    default:
                        throw new HTOSError('Unsupported fallback operation', 'FALLBACK_UNSUPPORTED');
                }
            } catch (error) {
                throw new HTOSError('Fallback strategy failed', 'FALLBACK_FAILED', { originalError: error });
            }
        });

        // Network fallback to cache
        this.fallbackStrategies.set('NETWORK_UNAVAILABLE', async (operation, context) => {
            console.warn('🔄 Falling back to cache for network operation:', operation);
            
            // Try to use cached data
            const cacheKey = `htos_cache_${context.url || context.key}`;
            const cached = localStorage.getItem(cacheKey);
            
            if (cached) {
                try {
                    return JSON.parse(cached);
                } catch (parseError) {
                    throw new HTOSError('Cached data corrupted', 'CACHE_CORRUPTED', { parseError });
                }
            }
            
            throw new HTOSError('No cached data available', 'NO_CACHE_AVAILABLE');
        });

        // Service worker fallback to direct operations
        this.fallbackStrategies.set('SERVICE_WORKER_UNAVAILABLE', async (operation, context) => {
            console.warn('🔄 Falling back to direct operation (no service worker):', operation);
            
            // Implement direct operations without service worker
            switch (operation) {
                case 'persistence':
                    return this.directPersistenceOperation(context);
                case 'session':
                    return this.directSessionOperation(context);
                default:
                    throw new HTOSError('Direct operation not supported', 'DIRECT_UNSUPPORTED');
            }
        });
    }

    /**
     * Setup default retry policies
     */
    setupDefaultRetryPolicies() {
        // Standard retry policy
        this.retryPolicies.set('STANDARD', {
            maxRetries: 3,
            baseDelay: 1000,
            maxDelay: 10000,
            backoffMultiplier: 2,
            jitter: true
        });

        // Aggressive retry for critical operations
        this.retryPolicies.set('CRITICAL', {
            maxRetries: 5,
            baseDelay: 500,
            maxDelay: 5000,
            backoffMultiplier: 1.5,
            jitter: true
        });

        // Conservative retry for non-critical operations
        this.retryPolicies.set('CONSERVATIVE', {
            maxRetries: 2,
            baseDelay: 2000,
            maxDelay: 15000,
            backoffMultiplier: 3,
            jitter: false
        });
    }

    /**
     * Handle an error with appropriate strategy
     */
    async handleError(error, context = {}) {
        const htosError = this.normalizeError(error, context);
        
        // Record the error
        persistenceMonitor.recordError(htosError, context);
        this.incrementErrorCount(htosError.code);
        
        // Check circuit breaker
        if (this.isCircuitBreakerOpen(htosError.code)) {
            throw new HTOSError('Circuit breaker open', 'CIRCUIT_BREAKER_OPEN', { originalError: htosError });
        }

        // Try recovery strategies
        if (htosError.recoverable) {
            try {
                return await this.attemptRecovery(htosError, context);
            } catch (recoveryError) {
                console.error('🚨 Recovery failed:', recoveryError);
                // Fall through to throw original error
            }
        }

        // Update circuit breaker
        this.updateCircuitBreaker(htosError.code, false);
        
        throw htosError;
    }

    /**
     * Normalize any error to HTOSError
     */
    normalizeError(error, context = {}) {
        if (error instanceof HTOSError) {
            return error;
        }

        let code = 'UNKNOWN_ERROR';
        let recoverable = true;

        // Categorize common errors
        if (error.name === 'QuotaExceededError') {
            code = 'STORAGE_QUOTA_EXCEEDED';
            recoverable = false;
        } else if (error.name === 'InvalidStateError') {
            code = 'INVALID_STATE';
        } else if (error.name === 'NotFoundError') {
            code = 'NOT_FOUND';
        } else if (error.name === 'NetworkError') {
            code = 'NETWORK_ERROR';
        } else if (error.name === 'TimeoutError') {
            code = 'TIMEOUT';
        } else if (error.message?.includes('IndexedDB')) {
            code = 'INDEXEDDB_ERROR';
        } else if (error.message?.includes('Service Worker')) {
            code = 'SERVICE_WORKER_ERROR';
        }

        return new HTOSError(error.message || String(error), code, { ...context, originalError: error }, recoverable);
    }

    /**
     * Attempt recovery using appropriate strategy
     */
    async attemptRecovery(error, context) {
        const strategy = this.getRecoveryStrategy(error.code);
        
        if (strategy) {
            console.log(`🔧 Attempting recovery for ${error.code} using strategy:`, strategy.name);
            return await strategy.execute(error, context);
        }

        // Try fallback strategies
        const fallbackStrategy = this.getFallbackStrategy(error.code);
        if (fallbackStrategy) {
            console.log(`🔄 Using fallback strategy for ${error.code}`);
            return await fallbackStrategy(context.operation, context);
        }

        throw new HTOSError('No recovery strategy available', 'NO_RECOVERY_STRATEGY', { originalError: error });
    }

    /**
     * Get recovery strategy for error code
     */
    getRecoveryStrategy(errorCode) {
        const strategies = {
            'INDEXEDDB_ERROR': {
                name: 'IndexedDB Recovery',
                execute: async (error, context) => {
                    // Try to reinitialize IndexedDB connection
                    if (context.reinitialize) {
                        await context.reinitialize();
                        return await context.retry();
                    }
                    throw error;
                }
            },
            'NETWORK_ERROR': {
                name: 'Network Recovery',
                execute: async (error, context) => {
                    // Wait and retry with exponential backoff
                    return await this.retryWithBackoff(context.operation, context, 'STANDARD');
                }
            },
            'TIMEOUT': {
                name: 'Timeout Recovery',
                execute: async (error, context) => {
                    // Retry with longer timeout
                    const newContext = { ...context, timeout: (context.timeout || 5000) * 2 };
                    return await this.retryWithBackoff(context.operation, newContext, 'CONSERVATIVE');
                }
            }
        };

        return strategies[errorCode];
    }

    /**
     * Get fallback strategy for error code
     */
    getFallbackStrategy(errorCode) {
        const fallbackMap = {
            'INDEXEDDB_ERROR': 'INDEXEDDB_UNAVAILABLE',
            'INDEXEDDB_UNAVAILABLE': 'INDEXEDDB_UNAVAILABLE',
            'NETWORK_ERROR': 'NETWORK_UNAVAILABLE',
            'SERVICE_WORKER_ERROR': 'SERVICE_WORKER_UNAVAILABLE'
        };

        const fallbackKey = fallbackMap[errorCode];
        return fallbackKey ? this.fallbackStrategies.get(fallbackKey) : null;
    }

    /**
     * Retry operation with exponential backoff
     */
    async retryWithBackoff(operation, context, policyName = 'STANDARD') {
        const policy = this.retryPolicies.get(policyName);
        let lastError;

        for (let attempt = 0; attempt < policy.maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    const delay = this.calculateDelay(attempt, policy);
                    console.log(`⏳ Retrying in ${delay}ms (attempt ${attempt + 1}/${policy.maxRetries})`);
                    await this.sleep(delay);
                }

                return await operation(context);
            } catch (error) {
                lastError = error;
                console.warn(`❌ Attempt ${attempt + 1} failed:`, error.message);
            }
        }

        throw new HTOSError('All retry attempts failed', 'RETRY_EXHAUSTED', { 
            attempts: policy.maxRetries, 
            lastError 
        });
    }

    /**
     * Calculate delay for exponential backoff
     */
    calculateDelay(attempt, policy) {
        let delay = policy.baseDelay * Math.pow(policy.backoffMultiplier, attempt);
        delay = Math.min(delay, policy.maxDelay);

        if (policy.jitter) {
            delay = delay * (0.5 + Math.random() * 0.5); // Add 0-50% jitter
        }

        return Math.floor(delay);
    }

    /**
     * Sleep for specified milliseconds
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Increment error count for circuit breaker
     */
    incrementErrorCount(errorCode) {
        const count = this.errorCounts.get(errorCode) || 0;
        this.errorCounts.set(errorCode, count + 1);
    }

    /**
     * Check if circuit breaker is open
     */
    isCircuitBreakerOpen(errorCode) {
        const breaker = this.circuitBreakers.get(errorCode);
        if (!breaker) return false;

        const now = Date.now();
        if (breaker.state === 'open' && now - breaker.openedAt > breaker.timeout) {
            // Move to half-open state
            breaker.state = 'half-open';
            console.log(`🔄 Circuit breaker for ${errorCode} moved to half-open`);
        }

        return breaker.state === 'open';
    }

    /**
     * Update circuit breaker state
     */
    updateCircuitBreaker(errorCode, success) {
        const threshold = 5; // Open after 5 failures
        const timeout = 60000; // 1 minute timeout

        if (!this.circuitBreakers.has(errorCode)) {
            this.circuitBreakers.set(errorCode, {
                state: 'closed',
                failures: 0,
                openedAt: null,
                timeout
            });
        }

        const breaker = this.circuitBreakers.get(errorCode);

        if (success) {
            breaker.failures = 0;
            breaker.state = 'closed';
        } else {
            breaker.failures++;
            if (breaker.failures >= threshold) {
                breaker.state = 'open';
                breaker.openedAt = Date.now();
                console.warn(`🚨 Circuit breaker opened for ${errorCode} after ${breaker.failures} failures`);
            }
        }
    }

    // Fallback implementations

    async saveToLocalStorage(key, data) {
        try {
            const serialized = JSON.stringify(data);
            localStorage.setItem(`htos_fallback_${key}`, serialized);
            return { success: true, fallback: true };
        } catch (error) {
            throw new HTOSError('localStorage save failed', 'LOCALSTORAGE_SAVE_FAILED', { error });
        }
    }

    async loadFromLocalStorage(key) {
        try {
            const data = localStorage.getItem(`htos_fallback_${key}`);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            throw new HTOSError('localStorage load failed', 'LOCALSTORAGE_LOAD_FAILED', { error });
        }
    }

    async deleteFromLocalStorage(key) {
        try {
            localStorage.removeItem(`htos_fallback_${key}`);
            return { success: true, fallback: true };
        } catch (error) {
            throw new HTOSError('localStorage delete failed', 'LOCALSTORAGE_DELETE_FAILED', { error });
        }
    }

    async listFromLocalStorage(prefix) {
        try {
            const keys = [];
            const fullPrefix = `htos_fallback_${prefix}`;
            
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(fullPrefix)) {
                    keys.push(key.substring(fullPrefix.length));
                }
            }
            
            return keys;
        } catch (error) {
            throw new HTOSError('localStorage list failed', 'LOCALSTORAGE_LIST_FAILED', { error });
        }
    }

    async directPersistenceOperation(context) {
        // Implement direct persistence without service worker
        throw new HTOSError('Direct persistence not implemented', 'DIRECT_PERSISTENCE_NOT_IMPLEMENTED');
    }

    async directSessionOperation(context) {
        // Implement direct session management without service worker
        throw new HTOSError('Direct session management not implemented', 'DIRECT_SESSION_NOT_IMPLEMENTED');
    }

    /**
     * Get error statistics
     */
    getErrorStats() {
        const stats = {
            totalErrors: 0,
            errorsByCode: {},
            circuitBreakers: {}
        };

        for (const [code, count] of this.errorCounts.entries()) {
            stats.errorsByCode[code] = count;
            stats.totalErrors += count;
        }

        for (const [code, breaker] of this.circuitBreakers.entries()) {
            stats.circuitBreakers[code] = {
                state: breaker.state,
                failures: breaker.failures,
                openedAt: breaker.openedAt
            };
        }

        return stats;
    }

    /**
     * Reset error counts and circuit breakers
     */
    reset() {
        this.errorCounts.clear();
        this.circuitBreakers.clear();
        console.log('🔄 Error handler reset');
    }
}

// Create global instance
export const errorHandler = new ErrorHandler();

// Make it available globally for debugging
if (typeof globalThis !== 'undefined') {
    globalThis.__HTOS_ERROR_HANDLER = errorHandler;
}

export default errorHandler;