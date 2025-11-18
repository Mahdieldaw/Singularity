## B. UI State Management & Rendering

**Purpose:** This document explains how the UI maintains turn state, reacts to backend messages, buffers streaming updates, and renders the chat view efficiently.

### Core State Model (Jotai)

The UI state is built on a "Map + Ordered IDs" pattern for performance.

#### 1. Primitives (The Source of Truth)

- **`turnsMapAtom` (Map<string, TurnMessage>):** An `atomWithImmer` map for O(1) read/write/update of any turn by its canonical ID.
- **`turnIdsAtom` (string[]):** An `atomWithImmer` array that defines the _render order_ of the turns.

#### 2. Derived State

- **`messagesAtom` (TurnMessage[]):** A derived `atom` that reads `turnIdsAtom` and `turnsMapAtom` to produce the ordered list of `TurnMessage` objects for rendering. This is what `Virtuoso` (the virtualized list) consumes.

#### 3. Workflow & Configuration Atoms

- **`currentSessionIdAtom` (string | null):** Tracks the active session.
- **`isLoadingAtom` (boolean):** True from `sendMessage` until `TURN_FINALIZED` or error.
- **`uiPhaseAtom` (UiPhase):** Tracks the UI's state ('idle', 'streaming', 'awaiting_action').
- **`activeAiTurnIdAtom` (string | null):** The ID of the `AiTurn` _currently_ being streamed into.
- **`activeRecomputeStateAtom` (object | null):** Holds the target for a recompute (`{ aiTurnId, stepType, providerId }`).
- **`selectedModelsAtom`, `mappingEnabledAtom`, `mappingProviderAtom`, `synthesisProviderAtom`:** Persisted `atomWithStorage` atoms that control the user's model configuration.

### Message Handling: Backend → UI State

The `usePortMessageHandler.ts` hook is the single bridge between backend messages and UI state.

#### 1. `TURN_CREATED` (Optimistic, Canonical ID)

This is the most important flow:

1.  The backend sends `TURN_CREATED` with the _canonical_ `userTurnId` and `aiTurnId`.
2.  The handler _does not swap any IDs_.
3.  It finds the optimistic `UserTurn` (which was already added to state by `useChat.ts` using its `clientUserTurnId`).
4.  It _immediately_ creates an optimistic `AiTurn` object using the canonical `aiTurnId` from the message.
5.  This new `AiTurn` is added to `turnsMapAtom` and its ID to `turnIdsAtom`.
6.  `activeAiTurnIdAtom` is set to this `aiTurnId`.

#### 2. `PARTIAL_RESULT` (Streaming)

1.  The handler receives a `PARTIAL_RESULT` message.
2.  It parses the `stepId` to determine the `responseType` ('batch', 'mapping', 'synthesis').
3.  It passes the `providerId`, `delta` (text chunk), and `responseType` to the **`StreamingBuffer`**.

#### 3. `StreamingBuffer` (Performance)

The `StreamingBuffer` (`ui/utils/streamingBuffer.ts`) is a critical performance component.

- It collects all deltas that arrive in a ~16ms (requestAnimationFrame) window.
- It batches them into a _single_ `setTurnsMap` call.
- This prevents `setState` storms (e.g., 5 providers streaming 30 tokens/sec = 150 `setState` calls/sec) and ensures a smooth 60fps render.
- The buffer updates the `text` and `status` fields on the correct `ProviderResponse` object within the optimistic `AiTurn`.

#### 4. `WORKFLOW_STEP_UPDATE`

This message signals the completion of a _step_.

1.  **On Success:**
    - It calls `streamingBuffer.flushImmediate()` to ensure all buffered text is rendered.
    - It takes the `result` object (e.g., `result.results` for batch, or just `result` for synthesis/mapping).
    - It updates the `turnsMapAtom`, finding the `activeAiTurnId` and materializing the full, completed `ProviderResponse` object into the correct map (e.g., `turn.batchResponses[providerId] = completedEntry`).
2.  **On Failure:**
    - It records an error-state `ProviderResponse` object in the `turnsMapAtom` for the failed provider/step.
    - It sets `isLoadingAtom` to `false`.

#### 5. `TURN_FINALIZED`

This message signals the end of the _entire workflow_.

1.  It calls `streamingBuffer.flushImmediate()`.
2.  It deeply merges the canonical `turn.ai` data from the message into the existing `AiTurn` object in `turnsMapAtom`.
3.  It sets `meta.isOptimistic: false` on the turn.
4.  It sets `isLoadingAtom: false` and `activeAiTurnIdAtom: null`.

### Component Responsibilities

- **`ChatView`:** The main view. Renders `Virtuoso` (virtualized list) which consumes the derived `messagesAtom`.
- **`MessageRow`:** A simple wrapper that subscribes to an `atom((get) => get(turnsMapAtom).get(turnId))` and renders either a `UserTurnBlock` or `AiTurnBlock`.
- **`UserTurnBlockConnected`:** Renders the `UserTurn` and manages its own expanded state.
- **`AiTurnBlockConnected`:** The most complex component. It subscribes to the `AiTurn` and `activeRecomputeStateAtom`. It renders:
  - `ProviderResponseBlockConnected` (for batch responses).
  - `ClipsCarousel` (for synthesis/mapping provider selection).
  - Markdown renderers for the _selected_ synthesis/mapping responses.
  - It manages local UI state for truncation, expansion, and tab selection ("Map" vs. "Options").
- **`ProviderResponseBlockConnected`:** Renders the grid of `batch` responses for a given turn.
- **`ChatInputConnected`:** Manages the text input and calls the `useChat().sendMessage` hook.
- **`CompactModelTrayConnected`:** Renders and controls the `selectedModelsAtom`, `mappingProviderAtom`, etc.

### Recompute UX Flow

1.  A user clicks a re-run button on a _historical_ `AiTurnBlock` (e.g., "Run Synthesis with Qwen").
2.  The `AiTurnBlock`'s click handler calls `runSynthesisForAiTurn(aiTurnId, 'qwen')` (from `useRoundActions.ts`).
3.  This hook sets the **`activeRecomputeStateAtom`** to `{ aiTurnId, stepType: 'synthesis', providerId: 'qwen' }`.
4.  It then calls the `recompute` primitive.
5.  The backend streams `PARTIAL_RESULT` messages. The `usePortMessageHandler`'s `StreamingBuffer` sees `activeRecomputeStateAtom` is set and routes the deltas to the _historical_ turn (`aiTurnId`) instead of the `activeAiTurnId`.
6.  `WORKFLOW_STEP_UPDATE` (completed) arrives. The handler finds the historical `AiTurn` in `turnsMapAtom` and pushes the _new_ `ProviderResponse` into its `synthesisResponses['qwen']` array.
7.  The `AiTurnBlock` for that historical turn re-renders, now showing "Qwen" in its `ClipsCarousel` with the new completed response. `activeRecomputeStateAtom` is set to `null`.

### Key Files & References

- **State:** `ui/state/atoms.ts` (All Jotai atoms)
- **Handler:** `ui/hooks/usePortMessageHandler.ts` (Backend → UI bridge)
- **Action:** `ui/hooks/useChat.ts` (UI → Backend action)
- **Recompute:** `ui/hooks/useRoundActions.ts` (Recompute action logic)
- **Streaming:** `ui/utils/streamingBuffer.ts` (Performance batching)
- **Types:** `ui/types.ts` (UI-specific `AiTurn` and `ProviderResponse` shapes)
- **Renderers:** `ui/components/AiTurnBlockConnected.tsx`, `ui/components/ProviderResponseBlockConnected.tsx`

### Invariants & Gotchas

- **Never Remap IDs:** The canonical `aiTurnId` from `TURN_CREATED` is used from start to finish.
- **Order:** `turnIdsAtom` _must_ maintain the correct `UserTurn` -> `AiTurn` order.
- **Step Parsing:** The `stepId` parsing in `usePortMessageHandler` must match backend patterns to distinguish `batch` vs. `mapping` vs. `synthesis` streams.
- **Flush:** The `StreamingBuffer` _must_ be flushed before materializing a `WORKFLOW_STEP_UPDATE (completed)` entry to prevent the final text from being overwritten by a stale buffered delta.
