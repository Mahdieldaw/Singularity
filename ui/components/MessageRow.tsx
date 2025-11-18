import React, { useMemo } from "react";
import { atom, useAtomValue } from "jotai";
import { turnsMapAtom } from "../state/atoms";
import UserTurnBlockConnected from "./UserTurnBlockConnected";
import AiTurnBlockConnected from "./AiTurnBlockConnected";

function MessageRow({ turnId }: { turnId: string }) {
  const turnAtom = useMemo(
    () => atom((get) => get(turnsMapAtom).get(turnId)),
    [turnId],
  );
  const message = useAtomValue(turnAtom);

  if (!message) {
    return (
      <div style={{ padding: "8px", color: "#ef4444" }}>
        Error: Missing turn {turnId}
      </div>
    );
  }

  const content =
    (message as any).type === "user" ? (
      <UserTurnBlockConnected userTurn={message as any} />
    ) : (
      <AiTurnBlockConnected aiTurn={message as any} />
    );

  // Wrap each row with an anchor for scroll/highlight targeting
  return (
    <div className="message-row" data-turn-id={turnId} id={`turn-${turnId}`}>
      {content}
    </div>
  );
}

export default React.memo(MessageRow);
