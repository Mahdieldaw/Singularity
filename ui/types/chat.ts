import { TurnMessage, UserTurn, AiTurn, ProviderResponse } from '../types';

// Bridge types for composer mode compatibility
export interface ResponseBlock {
  id: string;
  content: string;
  providerId: string;
  status?: 'pending' | 'streaming' | 'completed' | 'error';
  createdAt?: number;
  meta?: any;
}

export interface ChatTurn {
  id: string;
  type: 'user' | 'ai';
  content: string;
  timestamp: number;
  sessionId?: string;
  responses: ResponseBlock[];
  providerId?: string;
}

// Utility functions to convert between existing types and composer types
export const convertTurnMessageToChatTurn = (turn: TurnMessage): ChatTurn => {
  if (turn.type === 'user') {
    const userTurn = turn as UserTurn;
    return {
      id: userTurn.id,
      type: 'user',
      content: userTurn.text,
      timestamp: userTurn.createdAt,
      sessionId: userTurn.sessionId || undefined,
      responses: []
    };
  } else {
    const aiTurn = turn as AiTurn;
    const responses: ResponseBlock[] = [];
    
    // Convert batch responses
    Object.entries(aiTurn.batchResponses || {}).forEach(([providerId, response]) => {
      responses.push({
        id: `${aiTurn.id}-batch-${providerId}`,
        content: response.text,
        providerId,
        status: response.status,
        createdAt: response.createdAt,
        meta: response.meta
      });
    });
    
    // Convert synthesis responses
    Object.entries(aiTurn.synthesisResponses || {}).forEach(([providerId, responseArray]) => {
      responseArray.forEach((response, index) => {
        responses.push({
          id: `${aiTurn.id}-synthesis-${providerId}-${index}`,
          content: response.text,
          providerId: `${providerId}-synthesis`,
          status: response.status,
          createdAt: response.createdAt,
          meta: response.meta
        });
      });
    });
    
    // Convert mapping responses
    Object.entries(aiTurn.mappingResponses || {}).forEach(([providerId, responseArray]) => {
      responseArray.forEach((response, index) => {
        responses.push({
          id: `${aiTurn.id}-mapping-${providerId}-${index}`,
          content: response.text,
          providerId: `${providerId}-mapping`,
          status: response.status,
          createdAt: response.createdAt,
          meta: response.meta
        });
      });
    });
    
    // If no responses, create a placeholder
    if (responses.length === 0) {
      responses.push({
        id: `${aiTurn.id}-empty`,
        content: 'No response content',
        providerId: 'unknown'
      });
    }
    
    return {
      id: aiTurn.id,
      type: 'ai',
      content: responses[0]?.content || '',
      timestamp: aiTurn.createdAt,
      sessionId: aiTurn.sessionId || undefined,
      responses,
      providerId: responses[0]?.providerId
    };
  }
};

export const convertTurnMessagesToChatTurns = (turns: TurnMessage[]): ChatTurn[] => {
  return turns.map(convertTurnMessageToChatTurn);
};

// Type guards
export const isUserChatTurn = (turn: ChatTurn): boolean => turn.type === 'user';
export const isAiChatTurn = (turn: ChatTurn): boolean => turn.type === 'ai';

// Helper to get the primary response content
export const getPrimaryResponseContent = (turn: ChatTurn): string => {
  if (turn.type === 'user') {
    return turn.content;
  }
  
  // For AI turns, prefer batch responses, then synthesis, then mapping
  const batchResponse = turn.responses.find(r => !r.providerId.includes('-synthesis') && !r.providerId.includes('-mapping'));
  if (batchResponse) {
    return batchResponse.content;
  }
  
  const synthesisResponse = turn.responses.find(r => r.providerId.includes('-synthesis'));
  if (synthesisResponse) {
    return synthesisResponse.content;
  }
  
  return turn.responses[0]?.content || turn.content;
};

// Helper to get response by provider
export const getResponseByProvider = (turn: ChatTurn, providerId: string): ResponseBlock | undefined => {
  return turn.responses.find(r => r.providerId === providerId);
};

// Helper to get all providers for a turn
export const getTurnProviders = (turn: ChatTurn): string[] => {
  return Array.from(new Set(turn.responses.map(r => r.providerId.replace('-synthesis', '').replace('-mapping', ''))));
};