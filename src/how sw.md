// ============================================================================
// UNIFIED SERVICE WORKER ENTRY POINT
// Combines persistence layer, provider management, and message routing
// ============================================================================
// === bg: idempotent listener registration ===
if (!globalThis.__bg_listeners_installed) {
  globalThis.__bg_listeners_installed = true;

  // Named handler so hasListener can work reliably
  function onRuntimeMessage(req, sender, sendResponse) {
    // existing handler body...
  }

  try {
    if (!chrome.runtime.onMessage.hasListener(onRuntimeMessage)) {
      chrome.runtime.onMessage.addListener(onRuntimeMessage);
    }
  } catch (e) {
    // older runtimes may not have hasListener
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
  }

  // single centralized onConnect
  function onConnect(port) {
    console.info('[SW] Port connected', port.name);
    // If you add port.onMessage handlers, use named functions too:
    function handlePortMsg(msg) { /* ... */ }
    if (!port.__handlerRegistered) {
      port.__handlerRegistered = true;
      port.onMessage.addListener(handlePortMsg);
    }
    port.onDisconnect.addListener(() => {
      console.info('[SW] Port disconnected', port.name);
    });
  }

  if (!chrome.runtime.onConnect.hasListener?.(onConnect)) {
    chrome.runtime.onConnect.addListener(onConnect);
  } else {
    // fallback if hasListener missing
    chrome.runtime.onConnect.addListener(onConnect);
  }
}