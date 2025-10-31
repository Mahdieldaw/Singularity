import React from 'react';
import { TurnMessage } from '../types';
import UserTurnBlockConnected from './UserTurnBlockConnected';
import AiTurnBlockConnected from './AiTurnBlockConnected';

function MessageRow({ message }: { message: TurnMessage }) {
  if ((message as any).type === 'user') {
    return <UserTurnBlockConnected userTurn={message as any} />;
  }
  return <AiTurnBlockConnected aiTurn={message as any} />;
}

export default React.memo(MessageRow);
