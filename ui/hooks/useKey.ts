import { useEventListener } from "usehooks-ts";

type KeyCallback = (event: KeyboardEvent) => void;

export function useKey(key: string, callback: KeyCallback) {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === key) {
      callback(event);
    }
  };

  useEventListener("keydown", handleKeyDown);
}
