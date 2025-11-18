# Singularity

Singularity is a Chrome extension (Manifest V3) that orchestrates multi‑model AI conversations with real‑time streaming, local persistence, and reproducibility. It helps you compare providers side‑by‑side, compose their outputs, and keep a complete audit trail of every turn.

## What it does

- Fan‑out prompts to multiple providers in parallel (ChatGPT, Claude, Gemini, Qwen) and stream responses as they arrive.
- Optional “mapping” and “synthesis” steps to transform and compose provider outputs.
- Optimistic UI with canonical backend IDs: the UI renders immediately, while the backend sends TURN_CREATED → PARTIAL_RESULT → WORKFLOW_STEP_UPDATE → TURN_FINALIZED messages. The UI merges canonical data on finalization (no ID swapping).
- Append‑only history stored locally in IndexedDB. Provider continuation state lives in a fast lookup store keyed by [sessionId, providerId] for quick “extend” requests.
- Recompute past steps without advancing the timeline, enabling reliable reproduction and experiments.
- Built‑in observability: streaming deltas, per‑step updates, and clear turn lifecycle events.

## How it works (high level)

- Three request primitives: initialize (start), extend (continue), recompute (re‑run).
- Backend pipeline:
  1. Resolve: fetch required context (e.g., provider continuation state for a session)
  2. Compile: build a plan of steps (batch prompt → optional mapping → optional synthesis)
  3. Execute: stream partials, report step updates, persist results, then finalize the turn
- UI state: map‑based storage for O(1) lookups and an ordered ID list for rendering. A StreamingBuffer batches DOM updates for smooth 60fps during heavy streaming.

## Why it’s useful

- Fast, streaming‑first comparisons across providers
- Local, auditable history that never loses data
- Clear lifecycle and error handling with unified step updates
- Designed for reproducibility and iterative experimentation

## What’s in this repo

- src/core — connection handler, context resolver, workflow compiler, workflow engine
- ui — React UI (state atoms, message handlers, components)
- providers — adapters for supported models
- shared — data contracts and message types
- src/persistence — IndexedDB schema, adapter, and session management
- Singularity System Architecture Overview.md — living architectural reference

## Privacy & security

- No secrets committed to code; keep credentials in environment or provider settings.
- Data stays local in your browser’s IndexedDB.
- We follow “Security is truth” and “Code is truth”: observed behavior and running systems take precedence over assumptions.

## Learn more

For deeper architecture and contracts, see “Singularity System Architecture Overview.md” in the project root. It documents request primitives, message flows, persistence schema, and the Resolve → Compile → Execute pipeline.
