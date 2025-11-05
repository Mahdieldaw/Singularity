Nice — this is a fun, high-leverage feature. Below I give a compact, engineering-grade plan that fits cleanly into your existing Resolve → Compile → Execute pipeline, plus two concrete integration patterns (minimal invasive vs interactive), the precise places to change code, data-model suggestions (request/step fields), UI wiring, and tradeoffs so you can pick what you want fast.

I'll assume you want debate to work for new prompts first (initialize) and be easy to extend later to run from `extend`/historical turns. The design below uses existing primitives where possible and only asks for a few surgical changes.

---

# Design summary — two approaches (pick one)

1. **Compiled-sequence (elegant, low-run-time coupling)**
   Compiler generates a single workflow upfront: a sequence of `prompt` steps executed *sequentially* (not parallel), each directed at exactly one provider and seeded with stage-specific meta-prompts (argument → counter → conclusion). The WorkflowEngine already supports ordered execution of step arrays and carrying step results into later steps; extend the engine to substitute previous step results into the next step's prompt/payload. Minimal UI complexity: user chooses initial ordering or "auto-assign", optionally toggles “auto-run remaining” before start. Good if you want deterministic reproducibility and simple persistence/provenance. (Least invasive to adapter/orchestrator logic.)  

2. **Interactive (user-in-the-loop ordering)**
   WorkflowEngine executes the current step, then emits a `CHOICE_REQUIRED` event containing available next providers and stage context. UI shows buttons for each provider (and an "auto-run remaining" fallback). When the user selects, the ConnectionHandler (or UI) sends a small control message back (e.g., `DEBATE_SELECT`) and the engine resumes by inserting/executing the next step. This gives full dynamic control over the debate order but requires a tiny new interactive step or a pause/resume hook in the engine and a control message channel. Use this if you want live DJ-style debates with human steering. 

---

# Why this fits your architecture (short evidence)

* Compiler currently generates ordered `steps[]` (batch/mapping/synthesis) and returns a `workflowRequest` that the WorkflowEngine executes. That makes the compiler the right place to lay out a debate plan as steps. 
* WorkflowEngine already executes prompt → mapping → synthesis in order and maintains `stepResults`/`workflowContexts`, which is exactly what we need to feed previous outputs into later prompts. Extend that mechanism slightly for debate chaining. 
* Prompt steps already carry `providerMeta` and the engine passes `providerMeta` through to adapters (so meta-prompts and stage hints can be delivered without new transport fields). 

---

# Concrete changes (code + data model) — minimal and clear

## 1) Request-level API

Add an optional `debate` block to the `InitializeRequest` (and optionally `ExtendRequest`) so callers opt in:

```ts
// shared/contract.ts (new shape idea)
interface DebateConfig {
  enabled: true;
  initialOrder?: ProviderKey[] | 'user-select';
  stages?: ('argument'|'counter'|'conclusion')[];
  perProviderPrompts?: Partial<Record<ProviderKey, {
    argument?: string[];     // templates (rotate/choose)
    counter?: string[];
    conclusion?: string[];
  }>>;
  rotationRules?: any; // small DSL: choose template based on previousProvider
  interactive?: boolean; // if true => engine will pause for UI choice between steps
  autoRun?: boolean; // if true => compiled workflow auto-executes remaining steps
}
```

Put this in `InitializeRequest` (and `ExtendRequest` if you want debate-from-extend). Keep it optional so backwards compatibility is preserved.

## 2) Compiler: generate debate steps

Modify `WorkflowCompiler.compile` to detect `request.debate.enabled` and then:

* Decide sequence:

  * If `initialOrder` is an array, generate steps in that order.
  * If `initialOrder === 'user-select'`, generate a single *starter* step or none and instruct UI to prompt user for the first provider.
* For each stage per provider produce a `prompt` step whose payload contains:

  * `providers: [providerKey]` (single provider)
  * `providerMeta: { debate: { stage: 'argument'|'counter'|..., templateId, previousStepId? } }`
  * Optionally `payload.sourceStepIds` referencing previous step IDs so engine can substitute prior texts into that provider's prompt template.

Example step object (conceptual):

```js
{
  stepId: 'debate-batch-<ts>-A-arg',
  type: 'prompt',
  payload: {
    prompt: '<PLACEHOLDER_PROMPT_WITH_SUBSTITUTIONS>',
    providers: ['claude'],
    providerMeta: { debate: { stage: 'argument', templateKey: 'claude.arg.1', rotationIndex: 0 } },
    continueFromBatchStep: undefined
  }
}
```

You can reuse `prompt` step (no new step type) — compiler decides choreography.

## 3) Engine: sequential chaining + substitution + optional pause

Two small augmentations to `WorkflowEngine`:

A. **Substitution** — before executing a prompt step, allow the engine to expand the step.payload.prompt by substituting placeholders with text from previous `stepResults` (the engine already keeps `stepResults`). E.g. `{{previous:stepId:providerId}}` or `{{all_previous}}`. This is deterministic and keeps persistence/provenance intact. (Engine already resolves data for synthesis/mapping; reuse that pattern.) 

B. **Pause/Interactive hook** — if `step.payload.providerMeta?.debate?.interactivePause === true` (set by compiler for between-stage handoffs), the engine should:

* Emit `WORKFLOW_STEP_UPDATE` with `status: 'awaiting_choice'` and a payload listing allowed providers + stage + UI text.
* Put that workflow instance into a `waiting` map and return from `execute()` *only* when a resume message arrives from the ConnectionHandler (e.g., a `DEBATE_SELECT` control message containing `workflowId` and `selectedProvider`).
* When resume arrives, the engine continues by compiling/inserting the next prompt step (or using a precompiled step that corresponds to the selection).

Implementation pattern: an internal `awaitChoice(workflowId)` that returns a Promise resolved by `ConnectionHandler` when it receives the control message — similar to how you handle aborts (no background threads). This is a tiny engine control flow change; persistence and streaming remain unchanged. 

## 4) ConnectionHandler: accept control messages

Add handling for a new message type(s) from UI:

* `DEBATE_SELECT` — { workflowId, sessionId, selectedProvider } — which resolves the waiting Promise inside WorkflowEngine.
* `DEBATE_AUTORUN_TOGGLE` — updates workflow-level flag.

This is small; ConnectionHandler already routes messages and has lifecycle hooks. 

## 5) Persistence and provenance

Keep per-step provenance (engine already creates `provider_responses` and caches provider contexts after each prompt). For debate, **persist after each prompt step** instead of only at workflow end — that gives a clear audit trail and enables running debate from an arbitrary historical turn later. The engine currently persists consolidated results; make that optional or add a `persistAfterEachStep` flag for debate flows. 

---

# Prompt template rotation & stage templates (your 16 prompts problem)

You mentioned 16 prompts (4 per stage rotated by previous model). Implement this as a small template resolver in the Compiler:

* `perProviderPrompts[provider][stage]` is an array of 4 templates.
* Compiler chooses the template index via a deterministic rule: `index = rotationRules(previousProvider, provider, stage)`, or default rule `index = (seed + stageIndex + providerIndex) % 4`.
* The chosen template is injected into the step.payload.prompt or placed as `providerMeta.debate.templateId` and the engine resolves it before calling orchestrator.

Store templates in config (localStorage, or server-side) so you can iterate without code churn.

---

# UI design (practical wiring)

1. **Start UI** — small "Mode" toggle: Chat / Flow / Composer / Debate. When Debate selected, a compact composer appears with:

   * Model-order selector (drag to order providers) OR "user-select-first" option.
   * Toggle: `interactive` (user picks next) vs `auto-run`.
   * Toggle: `persist-after-step`.
   * Visual timeline showing stages per provider (argument → counter → conclusion) with chips.

2. **During debate** — beneath each provider response block show:

   * Buttons for "Next: [provider]" for each other provider (compact pill buttons).
   * "Auto-run remaining" toggle and small settings icon (change rotation).
   * A compact stage chip showing current stage & template used; a hover popup shows the actual meta-prompt that was sent.

3. **Events/UX** — when engine emits `awaiting_choice`, show a centered mini-dialog with provider buttons; allow keyboard numbers (1..n) for power users. Also show an "Inspect meta-prompt" button that opens the exact prompt (for research/auditing).

4. **Telemetry** — log chosen sequences and template indices so you can analyze which rotations produce best outcomes and tune templates.

Files that would need small UI touches: `CompactModelTray`, `ProviderResponseBlock`, `ChatInput` (for the debate toggle and ordering UI). These are already present so this is incremental. 

---

# Minimal change roadmap (ordered, no time promises — just complexity)

1. Compiler: accept `debate` block and emit sequential `prompt` steps (low code risk). 
2. Engine: implement substitution of previous step results into next prompt (low–medium). 
3. Engine: add optional pause/resume hook + waiting map + `DEBATE_SELECT` message support in ConnectionHandler (medium). 
4. SessionManager: enable optional per-step persistence or `persistAfterEachStep` flag (low). 
5. UI: add Debate Mode toggle, ordering UI, and inline "pick next model" buttons (low to integrate into existing components). 

---

# Tradeoffs & recommendations (challenge assumptions)

* If you want **reproducible research** (deterministic runs), prefer the *compiled-sequence* approach: produce the whole sequence in `compile()` and log exact template IDs and rotation indices there. This keeps a single canonical workflow to replay later. 
* If you want **live human curation**, the interactive approach is more engaging but introduces complexity: the engine must wait on UI events (careful with SW lifecycle) and you must persist intermediate state aggressively to survive reloads. Use `persistAfterEachStep` and heartbeat/lifecycle manager to keep SW alive.
* Avoid doing the entire debate as parallel fanout + offline reconciliation. The whole point here is sequential adversarial pressure; running parallel loses the sequential rhetorical effect. The architecture already supports sequential steps and historic seeding — use it. 

---

# Minimal code sketch — compiler + engine hook (illustrative)

**Compiler (pseudo)**

```js
if (request.debate?.enabled) {
  const order = computeOrder(request.debate);
  for (let i=0;i<order.length;i++) {
    for (const stage of request.debate.stages || ['argument','counter','conclusion']) {
      const provider = order[i];
      const template = chooseTemplate(request.debate, provider, stage, prevProvider);
      steps.push({
        stepId:`debate-${provider}-${stage}-${Date.now()}-${i}`,
        type:'prompt',
        payload:{ prompt: template, providers:[provider],
          providerMeta: { debate:{ stage, templateKey: template.id, awaitUserSelection: request.debate.interactive && i<order.length-1 }}
        }
      });
      prevProvider = provider;
    }
  }
}
```

**Engine wait/resume (pseudo)**

```js
if (step.payload.providerMeta?.debate?.awaitUserSelection) {
  this.port.postMessage({type:'WORKFLOW_STEP_UPDATE', status:'awaiting_choice', stepId, choices: [...providersRemaining], workflowId});
  await this._waitForUserChoice(workflowId); // resolved by ConnectionHandler receiving DEBATE_SELECT
}
```

---

# Final notes — safety, testing, and observability

* Add debug flags to log template indices and prior-provider mapping. That will let you quickly detect mis-rotations.
* Add fallback rules when a selected provider fails (skip to next or retry with variant template). WorkflowEngine already has good error handling for prompt step failures; mirror that logic. 
* For long-running interactive debates, ensure LifecycleManager records activity so SW doesn't sleep between steps. (You already have a lifecycle manager; reuse it.) 

---

If you want, next I can:

1. Draft the exact patch to `WorkflowCompiler.compile` that emits debate steps (diff).
2. Draft the tiny engine patch for substitution + awaitChoice with a ConnectionHandler update (diff).
3. Sketch the small UI React components (Composer mode add-ons + inline provider buttons).

Tell me which of the three you want first and I’ll produce the code diffs (or, if you'd rather, I’ll produce the DebateConfig JSON schema + a sample InitializeRequest showing the 16-template rotation applied to 3 providers). Which one do you want now?
