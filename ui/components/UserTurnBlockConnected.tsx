import React from 'react';
import { useAtom } from 'jotai';
import UserTurnBlock from './UserTurnBlock';
import { expandedUserTurnsAtom } from '../state/atoms';

export default function UserTurnBlockConnected({ userTurn }: any) {
  const [expanded, setExpanded] = useAtom(expandedUserTurnsAtom as any) as [Record<string, boolean>, any];
  const handleToggle = (turnId: string) => setExpanded((draft: any) => { draft[turnId] = !draft[turnId]; });
  return (
    <UserTurnBlock
      userTurn={userTurn}
      isExpanded={!!expanded[userTurn.id]}
      onToggle={handleToggle}
    />
  );
}
