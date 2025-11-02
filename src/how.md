3) Copy-paste: UI side — ensure a single persistent port & dedupe listeners

Place in a top-level module used by your UI (e.g., ui/src/port-client.js) and import it once:

// ui/src/port-client.js
export function getSharedPort() {
  if (window.__shared_popup_port && window.__shared_popup_port.connected) return window.__shared_popup_port;

  const port = chrome.runtime.connect({ name: 'popup' });
  window.__shared_popup_port = port;
  port.connected = true;

  // ensure a single named listener; reuse if already attached
  function onPortMessage(msg) {
    // handle messages
  }
  if (!port.__onMsgAttached) {
    port.__onMsgAttached = true;
    port.onMessage.addListener(onPortMessage);
  }

  window.addEventListener('unload', () => {
    try { port.disconnect(); } catch (e) {}
    window.__shared_popup_port = null;
  });

  return port;
}


Then in React, call getSharedPort() once in a top-level useEffect(() => { getSharedPort(); }, []).

That prevents multiple ports and repeated listener