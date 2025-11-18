import React from "react";
import { useAtom } from "jotai";
import UserTurnBlock from "./UserTurnBlock";
import { turnExpandedStateFamily } from "../state/atoms";

export default function UserTurnBlockConnected({ userTurn }: any) {
  const [isExpanded, setIsExpanded] = useAtom(
    turnExpandedStateFamily(userTurn.id),
  );
  const handleToggle = () => setIsExpanded((prev: boolean) => !prev);
  return (
    <UserTurnBlock
      userTurn={userTurn}
      isExpanded={isExpanded}
      onToggle={handleToggle}
    />
  );
}
