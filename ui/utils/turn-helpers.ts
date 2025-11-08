// ui/utils/turn-helpers.ts - ALIGNED VERSION
import type { AiTurn, ProviderResponse, UserTurn, ProviderKey } from '../types';
import { PRIMARY_STREAMING_PROVIDER_IDS } from '../constants';

/**
 * Normalize a response value to ProviderResponse[]
 * Backend can send either single object or array
 */
export function normalizeResponseArray(value: any): ProviderResponse[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as ProviderResponse[];
  return [value as ProviderResponse];
}

/**
 * Safely get the latest response from a provider's response array
 */
export function getLatestResponse(responses: ProviderResponse[] | ProviderResponse | undefined): ProviderResponse | undefined {
  if (!responses) return undefined;
  if (Array.isArray(responses)) return responses[responses.length - 1];
  return responses as ProviderResponse;
}

/**
 * Create an optimistic AI turn with proper structure
 */
export function createOptimisticAiTurn(
  aiTurnId: string,
  userTurn: UserTurn,
  activeProviders: ProviderKey[],
  shouldUseSynthesis: boolean,
  shouldUseMapping: boolean,
  synthesisProvider?: string,
  mappingProvider?: string,
  timestamp?: number,
  explicitUserTurnId?: string,
  requestedFeatures?: { synthesis: boolean; mapping: boolean }
): AiTurn {
  const now = timestamp || Date.now();
  
  // Initialize batch responses for all active providers
  const pendingBatch: Record<string, ProviderResponse> = {};
  activeProviders.forEach(pid => {
    pendingBatch[pid] = {
      providerId: pid,
      text: '',
      status: (PRIMARY_STREAMING_PROVIDER_IDS.includes(String(pid)) ? 'streaming' : 'pending'),
      createdAt: now,
      updatedAt: now
    };
  });
  
  // Initialize synthesis responses if enabled
  const synthesisResponses: Record<string, ProviderResponse[]> = {};
  if (shouldUseSynthesis && synthesisProvider) {
    synthesisResponses[synthesisProvider] = [{
      providerId: synthesisProvider as ProviderKey,
      text: '',
      status: (PRIMARY_STREAMING_PROVIDER_IDS.includes(String(synthesisProvider)) ? 'streaming' : 'pending'),
      createdAt: now,
      updatedAt: now
    }];
  }
  
  // Initialize mapping responses if enabled
  const mappingResponses: Record<string, ProviderResponse[]> = {};
  if (shouldUseMapping && mappingProvider) {
    mappingResponses[mappingProvider] = [{
      providerId: mappingProvider as ProviderKey,
      text: '',
      status: (PRIMARY_STREAMING_PROVIDER_IDS.includes(String(mappingProvider)) ? 'streaming' : 'pending'),
      createdAt: now,
      updatedAt: now
    }];
  }
  
  const effectiveUserTurnId = explicitUserTurnId || userTurn.id;

  return {
    type: 'ai',
    id: aiTurnId,
    createdAt: now,
    sessionId: userTurn.sessionId,
    threadId: 'default-thread',
    userTurnId: effectiveUserTurnId,
    batchResponses: pendingBatch,
    synthesisResponses,
    mappingResponses,
    meta: {
      isOptimistic: true,
      ...(requestedFeatures ? { requestedFeatures } : {})
    }
  };
}

/**
 * Apply streaming updates from StreamingBuffer
 */
export function applyStreamingUpdates(
  aiTurn: AiTurn,
  updates: Array<{ providerId: string; text: string; status: string; responseType: 'batch' | 'synthesis' | 'mapping' }>
) {
  updates.forEach(({ providerId, text: delta, status, responseType }) => {
    if (responseType === 'batch') {
      // Update batch responses (single object per provider)
      if (!aiTurn.batchResponses) aiTurn.batchResponses = {};
      const existing = aiTurn.batchResponses[providerId] || {
        providerId,
        text: '',
        status: (PRIMARY_STREAMING_PROVIDER_IDS.includes(String(providerId)) ? 'streaming' : 'pending'),
        createdAt: Date.now()
      };
      aiTurn.batchResponses[providerId] = {
        ...existing,
        text: (existing.text || '') + delta,
        status: status as any,
        updatedAt: Date.now()
      };
    } else if (responseType === 'synthesis') {
      // Update synthesis responses (array per provider)
      if (!aiTurn.synthesisResponses) aiTurn.synthesisResponses = {};
      const arr = normalizeResponseArray(aiTurn.synthesisResponses[providerId]);
      
      if (arr.length > 0) {
        // Update latest response
        const latest = arr[arr.length - 1];
        arr[arr.length - 1] = {
          ...latest,
          text: (latest.text || '') + delta,
          status: status as any,
          updatedAt: Date.now()
        };
      } else {
        // Create new response
        arr.push({
          providerId: providerId as ProviderKey,
          text: delta,
          status: status as any,
          createdAt: Date.now()
        });
      }
      
      aiTurn.synthesisResponses[providerId] = arr;
    } else if (responseType === 'mapping') {
      // Update mapping responses (array per provider)
      if (!aiTurn.mappingResponses) aiTurn.mappingResponses = {};
      const arr = normalizeResponseArray(aiTurn.mappingResponses[providerId]);
      
      if (arr.length > 0) {
        // Update latest response
        const latest = arr[arr.length - 1];
        arr[arr.length - 1] = {
          ...latest,
          text: (latest.text || '') + delta,
          status: status as any,
          updatedAt: Date.now()
        };
      } else {
        // Create new response
        arr.push({
          providerId: providerId as ProviderKey,
          text: delta,
          status: status as any,
          createdAt: Date.now()
        });
      }
      
      aiTurn.mappingResponses[providerId] = arr;
    }
  });
}

