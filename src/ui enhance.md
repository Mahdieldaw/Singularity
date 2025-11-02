
  File to Modify: `ui/services/extension-api.ts`

  This is the only file you need to touch. We will enhance the ExtensionAPI class.

  ---

  Step 1: Implement Graceful Port Disconnection (Goal 4: `unload` Event Handling)

  This is the most important new piece of logic to add. We need to ensure the port is cleanly disconnected when the user closes the UI.

  Location: Inside the constructor of the ExtensionAPI class.

  Action: Add a window.addEventListener to listen for the unload event. This ensures that no matter how the UI is closed (tab close,
  browser quit), we attempt to disconnect the port.

  How to Integrate:

    1 // In ui/services/extension-api.ts
    2 
    3 class ExtensionAPI {
    4   // ... existing private members (port, portHealthManager, etc.)
    5 
    6   constructor() {
    7     this.portHealthManager = new PortHealthManager('htos-popup', {
    8       onHealthy: () => this.notifyConnectionState(true),
    9       onUnhealthy: () => this.notifyConnectionState(false),
   10       onReconnect: () => this.notifyConnectionState(true),
   11     });
   12 
   13     // ADD THIS BLOCK:
   14     // Ensure the port is disconnected when the UI window is closed.
   15     window.addEventListener('unload', () => {
   16       if (this.port) {
   17         try {
   18           this.port.disconnect();
   19           this.port = null;
   20           console.log('[ExtensionAPI] Port disconnected on UI unload.');
   21         } catch (e) {
   22           // Ignore errors, as the port might already be closed.
   23         }
   24       }
   25     });
   26   }
   27 
   28   // ... rest of the class methods (onConnectionStateChange, ensurePort, etc.)
   29 }

  ---

  Step 2: Verify Single Port Instance Logic (Goals 1 & 2)

  Your code already does an excellent job of this. The task here is to understand why it's already correct and confirm it aligns with the
   plan.

  Location: Inside the ensurePort method of the ExtensionAPI class.

  Analysis (No Code Change Needed):

  Your ensurePort method already performs the check described in the plan.

    1 // In ui/services/extension-api.ts, inside ensurePort()
    2 
    3 // This block already implements the "check if already connected" logic.
    4 if (this.port && !force) {
    5   const status = this.portHealthManager?.getStatus();
    6   if (status?.isConnected) {
    7     // It correctly returns the existing, healthy port instance.
    8     return this.port;
    9   }
   10 }
   11 
   12 // This part is only reached if the port is null, disconnected, or forced.
   13 // It uses the PortHealthManager to create and manage the single connection.
   14 if (this.portHealthManager && this.portMessageHandler) {
   15   this.port = this.portHealthManager.connect(...);
   16   return this.port;
   17 }

  Conclusion: Your existing code correctly implements a single, centralized port instance. The this.port class member serves the role
  of the global variable, and ensurePort correctly returns this instance if it's healthy, preventing new ports from being created on
  every call.

  ---

  Step 3: Verify Listener Deduplication (Goal 3)

  This is also handled correctly by your existing architecture, but it's important to understand how.

  Location: Inside the ensurePort method and the PortHealthManager's behavior.

  Analysis (No Code Change Needed):

  The goal is to ensure port.onMessage.addListener is only called once for a given connection. Your code achieves this through the
  PortHealthManager.

   * When this.portHealthManager.connect(...) is called, it creates a new port object and attaches the message handler you provide.
   * If the port disconnects, the onDisconnect listener fires, and your code sets this.port = null.
   * The next time ensurePort is called, it sees this.port is null and creates a brand new port object, attaching a new listener to that
     new object.

  This is a clean and effective pattern. The port.__onMsgAttached flag from the how.md snippet is a defensive technique for when you
  might be re-using the same port object. Since your code correctly discards the old port and creates a new one, you don't have the
  problem of attaching multiple listeners to the same object. Your PortHealthManager handles this lifecycle correctly.

  ---

  Summary of Implementation

   1. Primary Action: Add the window.addEventListener('unload', ...) logic to the ExtensionAPI constructor. This is the only required code
       change to fully align with the plan.
   2. Verification: The rest of the plan involves reviewing your existing ensurePort method and understanding that it already correctly
      implements the single-port and listener-deduplication logic, thanks to the robust PortHealthManager. No further changes are needed
      for those parts.
   1. Centralized Port Instance:
       * The ExtensionAPI class already has a private member this.port. This will serve the same purpose as window.__shared_popup_port,
         ensuring only one port instance is managed by the API.

   2. `ensurePort` Method Enhancement:
       * The ensurePort method is where the connection logic resides. It would be modified to incorporate the "check if already
         connected" logic from getSharedPort.
       * It would first check if (this.port && this.port.connected) (or this.portHealthManager?.getStatus()?.isConnected) to return the
         existing port if it's healthy.
       * If no port exists or it's disconnected, it proceeds to establish a new connection using chrome.runtime.connect().

   3. Deduplicating Listeners:
       * The ExtensionAPI already has a portMessageHandler and uses this.port.onMessage.addListener().
       * The key is to ensure that addListener is called only once for a given port instance. The port.__onMsgAttached flag from the
         snippet can be adapted as a private class member (e.g., this.messageListenerAttached) to track this.
       * When a new port is established, the listener is attached. If the port disconnects and reconnects, the ensurePort logic would
         need to ensure the listener is re-attached only if it's a new port instance or if the previous listener was explicitly removed.
         The PortHealthManager already handles some of this by reconnecting and re-attaching the listener.

   4. `unload` Event Handling:
       * The window.addEventListener('unload', ...) logic from the snippet is important for gracefully disconnecting the port when the UI
          page closes.
       * This can be integrated into the ExtensionAPI's lifecycle, perhaps by adding an event listener in the ExtensionAPI constructor or
          by ensuring the PortHealthManager handles port disconnection on UI unload events.