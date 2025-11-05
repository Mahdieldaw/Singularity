export const debateTemplates = {
  chatgpt: {
    stage1: [
      "You are {{current_model}} acting as a neutral facilitator. Stage: Foundation. Task: lay out the problem space for {{user_prompt}}. Define terms, enumerate assumptions, constraints, success criteria, and immediate unknowns. If prior turns exist from {{previous_model}}, summarize their core claims in 3 bullets referencing «quotes» from {{prior_responses}}. Output sections: 1) Problem statement, 2) Assumptions, 3) Constraints, 4) Success metrics, 5) Initial stance (one sentence). Keep under 180 words.",
      "Stage: Foundation. Produce an executive baseline for {{user_prompt}} with a decision architecture: Options (3–5), Benefits, Risks, Dependencies. If {{prior_responses}} exist, tease out tensions (≤3) and mark each as Tension-[n] with «quoted» evidence. End with a single Anchor Fact you believe is widely defensible now.",
      "Foundation turn with persona {{persona}}: create a conceptual map. Nodes: Goals, Inputs, Processes, Outputs, Feedback loops. Use compact bullets. Cite any prior key phrases with «…». Conclude with a 2-line neutral hypothesis that can be contested next.",
      "Foundation: write a crisp brief. Include: Scope boundary, Stakeholders, Non-goals, Required guarantees, Open questions (≤4). If you follow {{previous_model}}, acknowledge one strength and one blind spot, each with provenance «…». Finish with a one-sentence baseline proposition to anchor debate."
    ],
    stage2: [
      "You are now the Opposition. Stage: Counterargument. Challenge the strongest claims made so far for {{user_prompt}}. Identify 3–4 critical trade-offs and failure modes. Use ‘Counterpoint → Evidence’ pairs citing «prior text». Avoid strawmen; steelman the opposing view before refuting. End with a single decisive risk that would overturn the foundation if true.",
      "Counterargument with persona {{persona}}: pick the current dominant stance and present a structured critique: (1) Misplaced assumption, (2) Overlooked constraint, (3) Empirical counterexample, (4) Ethical/UX risk. For each, quote «support» from {{prior_responses}} and propose a test to adjudicate.",
      "Oppose by reframing. Offer an alternative framing of {{user_prompt}} that yields different priorities. Contrast the framings across: Objective, Cost, Time, Quality, Safety. Call out any category where the original plan underperforms, with «provenance». Close with one counter-hypothesis to be stress-tested next.",
      "Deliver a red-team pass. Enumerate plausible ways the foundation fails in practice: Data issues, Integration barriers, Edge-case behavior, Governance/security. Attach a severity (Low/Med/High) and cite «evidence». Do not propose fixes yet—keep it purely adversarial and grounded."
    ],
    stage3: [
      "Stage: Defense. Select the single strongest argument present so far (name it) and build a rigorous defense. Provide: Formal claim, Supporting premises (3–5), Empirical anchors (cite «prior»), Risk mitigations. Where counterarguments exist, defuse them with scoped concessions. End with a confidence estimate (0–1) and conditions that would lower it.",
      "Defense with persona {{persona}}: consolidate the case by adding missing evidence. Create ‘Claim → Backing → Warrant → Rebuttal’ lines (Toulmin style). Quote prior turns. If a premise lacks backing, label it ‘Hypothesis’ and propose a quick probe/measurement.",
      "Defend pragmatically. Translate the favored stance into an executable plan sketch: 5–7 steps, inputs/outputs, checkpoints, and a rollback criterion. For each step, reference «prior» rationales. Close with why this plan dominates alternatives on one unambiguous metric.",
      "Defend by quantifying. Build a simple scorecard: Benefits, Costs, Risks, Confidence, Time-to-value. Assign rough numeric weights based on prior content and indicate uncertainty. If the score beats the best counter, explicitly state by how much and why."
    ],
    stage4: [
      "Stage: Rebuttal. Target the defense’s weakest joints. For each defended premise, present a pointed rebuttal: (a) Scope creep risk, (b) Hidden dependency, (c) Measurement bias, (d) Safety/compliance trap. Support with «citations». Conclude with a single experiment that could falsify the defense quickly.",
      "Rebuttal with persona {{persona}}: stress-test assumptions under adverse scenarios. Provide 3 scenarios (edge, worst-case, adversarial) and explain how the defense breaks or holds. Quote prior turns to keep provenance. Suggest minimal safeguards that would preserve viability.",
      "Perform a contradiction audit. Scan the defense and earlier foundation for internal inconsistencies or unaligned definitions. List contradictions → likely cause → resolution path. Use «prior quotes». End with whether the contradiction is material (Yes/No) and why.",
      "Deliver a surgical rebuttal: isolate the single premise whose failure would collapse the plan. Examine its evidence chain, point to gaps, and assign a falsification test. Keep to 150–180 words, heavy on grounded references."
    ],
    stage5: [
      "Stage: Verdict. Produce one unrefutable core statement distilled from the debate—minimize qualifiers, avoid speculation. Provide: Core statement (≤25 words), Why it stands (2 bullets citing «prior»), Boundary where it may not apply, One metric/test that can repeatedly validate it.",
      "Verdict with persona {{persona}}: extract the invariant. State the invariant, then attach 3 concise evidence tags (E1–E3) with «quotes». Offer a single actionable next step aligned to this invariant.",
      "Render the irreducible insight as a decision rule: IF [condition], THEN [action], BECAUSE [fact]. Keep it auditable with «provenance». No new claims; only synthesis.",
      "Conclude with the unarguable core and a short rationale: Core → Rationale (2 bullets) → Validation method. Must be independent of model persona and consistent with earlier turns."
    ]
  },
  claude: {
    stage1: [
      "Foundation (reflective). Clarify the problem {{user_prompt}} with careful definitions, scope boundaries, and epistemic status of each assumption (Known/Believed/Unknown). If following {{previous_model}}, acknowledge nuance in their stance with «citations». End with a balanced thesis that invites critique.",
      "Establish a reasoned baseline: articulate ethical, usability, and long-tail considerations up front. Create sections: Users, Contexts, Failure modes, Safeguards, Success signs. Tie each to prior text with «quotes». Offer one question that, if answered, would reduce most uncertainty.",
      "Compose a gentle but precise overview. Use layered bullets: Core objective → Sub-goals → Constraints. Mark areas of ambiguity explicitly. Conclude with a modest, testable initial claim.",
      "Set the stage with a narrative summary: what matters, why now, what good looks like, what not to do. Maintain humility about unknowns. Include 2–3 ‘care points’ derived from «prior»."
    ],
    stage2: [
      "Counterargument (thoughtful). Steelman the current dominant view for {{user_prompt}} before raising objections. Present 3 objections: conceptual, empirical, ethical. Anchor each to «prior» text. Propose reflective questions that would shift perspective.",
      "Challenge assumptions with care. Identify subtle category errors or conflations. For each, show the impact if uncorrected and quote «evidence». Avoid absolute language; keep it proportional.",
      "Offer a principled critique: use norms (safety, clarity, fairness) as lenses. Where the foundation wavers on a norm, highlight and suggest criteria to re-align. Grounded in «prior».",
      "Deliver a considerate red-team: possible harms, misunderstood stakeholders, failure cascades. Keep the tone constructive but firm. Cite «prior» and end with one discriminating test."
    ],
    stage3: [
      "Defense (careful). Choose the strongest position and fortify it with transparent reasoning: premises, warrants, evidence, and a candid uncertainty ledger. Quote «prior». Where uncertainty is high, propose gentle probes rather than sweeping claims.",
      "Defend by aligning with stakeholder values. Map the argument to who benefits/risks and why. Add practical mitigations. Keep references explicit with «citations».",
      "Defend through clarity. Re-state the claim in clean language; remove ambiguity. Provide a roadmap with checkpoints and criteria of success/failure. Anchor each step to «prior» insights.",
      "Defend with comparative analysis: contrast leading alternative and explain why the chosen path better fits constraints and ethics. Use concise, respectful tone and «provenance»."
    ],
    stage4: [
      "Rebuttal (precise). Examine the defense line-by-line to surface the least supported link. Explain gently but concretely. Provide a small experiment or observation protocol to challenge that link. Keep citations «…».",
      "Stress-test with human-centered scenarios: edge-user, novice-user, and power-user. Indicate where experience breaks. Point to prior claims with «quotes». Suggest small design safeties.",
      "Conduct a coherence check: look for misaligned objectives or conflicting constraints. List discrepancies with causes and fixes. Keep tone measured, sources «prior».",
      "Deliver a minimal rebuttal: one premise, one challenge, one test. No theatrics, just clarity."
    ],
    stage5: [
      "Verdict (invariant). State a core insight that is both true and helpful, stripped of flourish. Add 2 references to «prior». Define a boundary of applicability and a way to keep it honest.",
      "Name the non-negotiable principle revealed. Provide a brief justification (≤2 bullets) and a single next step that respects it. Provenance required.",
      "Express the decision rule succinctly and ethically: IF/THEN/BECAUSE with «citations». No new claims.",
      "Offer a compact synthesis: one sentence core + one validation method. Keep it calm, clear, and durable."
    ]
  },
  gemini: {
    stage1: [
      "Foundation (pattern-first). For {{user_prompt}}, sketch a concept map: entities, relationships, flows, and feedback. Identify 3 archetypes/patterns that fit. Quote «prior» where relevant. End with a pattern-matched hypothesis.",
      "Lay the groundwork via analogy: compare {{user_prompt}} to 2 adjacent domains. Extract transferrable principles and constraints. Use bullets, include «citations». Conclude with an analogical anchor claim.",
      "Produce a structural overview: Inputs → Transformations → Outputs → Evaluation. Mark known/unknown for each node. Tie to prior content with «quotes». Finish with a candidate architecture statement.",
      "Generate a baseline blueprint: components, interfaces, risks, and learning loops. If following {{previous_model}}, integrate their best idea and call out one structural gap with «evidence»."
    ],
    stage2: [
      "Counter (creative stress). Recast the problem under a different lens (e.g., adversarial, resource-constrained, safety-first) and show why current stance struggles. Provide 3 crisp failure stories with «provenance».",
      "Challenge by exploring negative patterns (anti-patterns). List mismatches between chosen pattern and context. For each mismatch, show impact and cite «prior».",
      "Present an imaginative counter: a contrasting architecture that better fits one constraint. Compare side-by-side on 4 criteria. Quote «prior».",
      "Deliver a counter grounded in edge cases: pick unusual inputs or paths and demonstrate breakdowns. Keep it visual in structure, textual in output, with citations."
    ],
    stage3: [
      "Defense (structure). Choose the dominant architecture and justify with pattern fit: principles, constraints, empirical hints. Tie back to «prior». Add a short execution path with checkpoints.",
      "Defend via synthesis. Merge compatible ideas from prior turns into a stronger composite. Explain why the composite resolves earlier tensions. Use «citations».",
      "Defend by diagramming the data flow (textually): Source, Transform, Validate, Persist, Observe. Indicate how each step answers counterarguments. Cite «prior».",
      "Defend by criterion weighting: pick 5 criteria, assign weights, score alternatives. Show the winning margin and rationale."
    ],
    stage4: [
      "Rebuttal (pattern stress). Probe the defense for brittle assumptions under pattern drift. Where would it break if context shifts? Provide 3 drift scenarios and tie to «prior».",
      "Run a robustness pass: simulate low-resource, high-noise, and adversarial conditions. Identify weak points. Propose a single hardening tactic for the worst point.",
      "Audit interfaces: highlight any ambiguous contracts or hidden couplings. Provide ‘Issue → Evidence → Fix’. Quote «prior».",
      "Minimal rebuttal: expose one critical mismatch between claimed pattern and actual constraints, then suggest a test to reveal it."
    ],
    stage5: [
      "Verdict (pattern invariant). State the core principle that remains true across contexts. Justify briefly with «citations». Offer one check that confirms the pattern fit before action.",
      "Name the decisive structural truth and a single implication for design. Keep concise, grounded, referenced.",
      "Express a decision heuristic: IF context exhibits [signals], THEN choose [pattern], BECAUSE [fact]. Include provenance.",
      "Conclude with the irreducible structural insight plus a validation step to guard against drift."
    ]
  },
  qwen: {
    stage1: [
      "Foundation (engineering-first). For {{user_prompt}}, outline technical approach: architecture, data, interfaces, dependencies, constraints (latency, throughput, cost), and safety. Reference any prior requirements with «quotes». Finish with a pragmatic baseline plan.",
      "Establish system boundaries and invariants. Define inputs/outputs, error handling, and observability. Provide 3 non-negotiables. If following {{previous_model}}, integrate one element and flag one risk with evidence.",
      "Produce a feasibility brief: resources, integration points, failure classes, fallback/rollback. Link to prior content. End with an executable first step.",
      "Write a concise engineering summary: components, APIs, data contracts, and test strategy. Include «provenance». Close with a clear acceptance criterion."
    ],
    stage2: [
      "Counter (practical). Identify implementation pitfalls: data quality, API limits, schema drift, security/privacy. For each, show how it undermines the plan and cite «prior». Propose lightweight probes to verify.",
      "Challenge performance/cost trade-offs. Provide back-of-the-envelope estimates that contradict optimistic claims. Ground in prior facts where possible.",
      "Oppose via integration risk analysis: list external dependencies and their failure modes. Tie impacts to user experience and quote «prior».",
      "Deliver a security-focused counter: threat model basic surfaces (input, storage, transport). Point out weak links and minimum viable hardening."
    ],
    stage3: [
      "Defense (engineering). Choose the strongest plan and reinforce with testability: unit tests, canaries, metrics, alerts. Explain how each mitigates earlier risks. Cite «prior».",
      "Defend by specifying clear contracts. Define schemas, versioning, and compatibility. Show how this resolves critiques. Attach references.",
      "Defend with a rollout plan: phases, gates, success criteria, rollback. Connect to prior arguments.",
      "Quantify defense: estimate performance with simple calculations. Compare to counter claims. If margins are tight, say so and add contingency."
    ],
    stage4: [
      "Rebuttal (precision). Inspect the defense’s weakest assumption. Provide a targeted challenge and a measurement plan (metric, threshold, frequency). Keep references explicit.",
      "Stress-test with operational realities: monitoring gaps, on-call noise, incident response. Show where defense underestimates ops risk. Cite prior.",
      "Perform a data contract audit: ambiguities, validation gaps, migration risks. Offer a minimal fix.",
      "Minimal rebuttal: one critical dependency, one failure story, one validation step."
    ],
    stage5: [
      "Verdict (operational truth). State one core fact that governs viability in production. Support with 2 grounded references. Provide a single operational check to keep it true.",
      "Name the practical invariant (e.g., data quality threshold, SLO). Justify briefly and suggest a monitoring hook.",
      "Express a simple runbook rule: IF [signal], THEN [action], BECAUSE [fact]. Include «provenance».",
      "Conclude with the hard constraint that cannot be ignored and how to validate it continually."
    ]
  }
};

export default debateTemplates;