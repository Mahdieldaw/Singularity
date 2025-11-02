
   1. Wrap Existing `onMessage` Listener:
       * Locate your existing chrome.runtime.onMessage.addListener call in src/sw-entry.js.
       * Wrap it within the if (!globalThis.__bg_listeners_installed) block.
       * Use a named function for your existing message handler (handleUnifiedMessage and the GET_HEALTH_STATUS logic) so hasListener can
          check for it.

   2. Wrap Existing `onConnect` Listener:
       * Locate your existing chrome.runtime.onConnect.addListener call in src/sw-entry.js.
       * Wrap it within the same if (!globalThis.__bg_listeners_installed) block.
       * Use a named function for your existing onConnect handler.

   3. Remove Redundant `port.onMessage.addListener` from Snippet:
       * The onConnect function in the snippet includes port.onMessage.addListener(handlePortMsg). This is redundant and conflicting with
          your ConnectionHandler's role. Your ConnectionHandler already attaches its own port.onMessage.addListener when it's
         initialized. This part of the snippet should not be integrated.

  In summary: The snippet provides a valuable pattern for idempotence. However, it needs to be applied by wrapping your existing, fully
   functional listeners in src/sw-entry.js with the globalThis.__bg_listeners_installed check and hasListener calls, rather than adding
   new, separate listeners.