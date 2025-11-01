import React, { useMemo } from 'react';
import { atom, useAtomValue } from 'jotai';
import { turnsMapAtom } from '../state/atoms';
import UserTurnBlockConnected from './UserTurnBlockConnected';
import AiTurnBlockConnected from './AiTurnBlockConnected';

function MessageRow({ turnId }: { turnId: string }) {
  const turnAtom = useMemo(() => atom((get) => get(turnsMapAtom).get(turnId)), [turnId]);
  const message = useAtomValue(turnAtom);

  if (!message) {
    return <div style={{ padding: '8px', color: '#ef4444' }}>Error: Missing turn {turnId}</div>;
  }

  if ((message as any).type === 'user') {
    return <UserTurnBlockConnected userTurn={message as any} />;
  }
  return <AiTurnBlockConnected aiTurn={message as any} />;
}

export default React.memo(MessageRow);
