## What Happened

- Service worker startup calls `initializePersistence()` which invokes `initializePersistenceLayer` in `src/persistence/index.ts:19-74`.
- `initializePersistenceLayer` performs IndexedDB schema checks, creates `SimpleIndexedDBAdapter`, then dynamically imports `createSessionManager` from `src/persistence/SessionManager.js` (`src/persistence/index.ts:63-65`).
- `src/persistence/SessionManager.js` only exports `class SessionManager` (no factory function) (`src/persistence/SessionManager.js:9`), so the dynamic import returns `undefined` for `createSessionManager` and causes `TypeError: createSessionManager is not a function`.
- The error is caught and normalized by `ErrorHandler.handleError` (`src/utils/ErrorHandler.js:140-166`). Because the code is categorized as generic and no matching recovery/fallback strategy exists, `attemptRecovery` throws `HTOSError('No recovery strategy available')` (`src/utils/ErrorHandler.js:203-219`).
- The main bootstrap IIFE logs the failure (`src/sw-entry.js:1109-1114`).

## Root Cause

- Export mismatch: `index.ts` expects a `createSessionManager` factory, but `SessionManager.js` only provides a class. This surfaced after the document manager/composer cleanup removed/changed APIs.

## Changes (Minimal, Safe)

1. Add a small factory to `src/persistence/SessionManager.js`:
   - `export function createSessionManager(adapter) { const sm = new SessionManager(); sm.sessions = self.__HTOS_SESSIONS || {}; return sm; }`
   - Optionally call `await sm.initialize({ adapter })` inside the factory to ensure it is ready before returning; if we prefer non-async factories, keep `initialize` in `index.ts`.
2. Update `src/persistence/index.ts` to instantiate and initialize the manager using the adapter:
   - Replace dynamic import usage with the class, or keep the import and call the new factory.
   - Example approach (keeps current intent):
     - `const { createSessionManager } = await import('./SessionManager.js');`
     - `const sessionManager = createSessionManager(adapter);`
     - `await sessionManager.initialize({ adapter });`
3. Align `initializeSessionManager` in `src/sw-entry.js:120-136`:
   - Pass the persistence adapter from the already-initialized layer: `await sessionManager.initialize({ adapter: persistenceLayer.adapter });`
   - Avoid opening multiple adapters and ensure a single IndexedDB connection.

## Validation

- Reload the extension and watch logs:
  - Expect `[SW] ✅ Persistence layer initialized` (`src/sw-entry.js:89`) and no `[SW] Bootstrap failed`.
  - Send `GET_HEALTH_STATUS` and verify:
    - `persistenceLayer: 'active'`, `adapterReady: true`, `sessionManagerType: 'SessionManager'` (`src/sw-entry.js:1031-1055`).
- Exercise basic flows:
  - `GET_FULL_HISTORY` should list sessions via adapter (`src/sw-entry.js:480-516`).
  - `GET_PERSISTENCE_STATUS` returns adapter status without errors (`src/sw-entry.js:883-893`).

## Follow-Ups (Next Pass)

- Message types still referencing removed APIs:
  - `SAVE_TURN`, `CREATE_THREAD`, `SWITCH_THREAD` call legacy methods removed from `SessionManager.js` (`src/sw-entry.js:767-801`).
  - Migrate these to `SessionManager.persist()` primitives:
    - `SAVE_TURN` → `persist('extend', ...)`
    - `CREATE_THREAD`/`SWITCH_THREAD` → new thread handling via persistence (or temporarily disable until implemented).
- Optional error resilience:
  - Add a recovery strategy for module export mismatches that retries with direct class construction and `initialize({ adapter })`.

## Outcome

- Fixes the startup failure by restoring the expected factory or instantiating the class with the adapter.
- Ensures a single, ready `SessionManager` tied to the persistence adapter.
- Prepares the codebase for migrating legacy message handlers to the new persistence primitives.
