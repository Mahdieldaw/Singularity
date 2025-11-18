
Updated Priority List (Based on Your Feedback)

P0: Error Boundaries (Stability)
P0: Memory Management (Performance/Stability)
P1: UI Performance (#13 & #12) (Smoother UX - Includes atomFamily and StreamingBuffer tweaks)
P1: Dead Code Removal (#11) (Clarity/Performance)
P3: Circuit Breakers & Rate Limiting (#7 & #8) (Network Resilience)
P0: Service Worker Bootloader (Reliability)


P1: Persistence SSOT (#4) (Data Integrity)
P2: Data Migrations (#5) (Long-term Data Safety)
P2: Observability (#6) (Debugging)
P3: Automation (CI/CD, Budgets) (#16 & #17) (Future-proofing)
P4: TypeScript Migration (#10) (Long-term maintainability)
P4: Arkose Isolation (#9) (Deferred hardening)




1. Error Boundaries (Fix #2)
Why it's easy: This is purely additive. You are wrapping existing components. You don't change any logic inside AiTurnBlock or ChatView.
How to do it:
Go to ui/App.tsx.
Wrap your main <ChatView /> component with the <ErrorBoundary> you already have.
<ErrorBoundary><ChatView /></ErrorBoundary>
Can you do it halfway? Yes. You can wrap one component today and another tomorrow. The rest of the app remains unaffected.
Time estimate: 15-30 minutes.
2. Observability / Flight Recorder Logging (Fix #6)
Why it's easy: You're just creating a new SystemLogger class and sprinkling logger.log() calls throughout your existing code. The core logic of your workflow-engine or connection-handler doesn't change at all.
How to do it:
Create src/debug/SystemLogger.js.
Instantiate it in sw-entry.js: const logger = new SystemLogger();
Add log points: logger.log('info', 'WORKFLOW_STARTED', { ... }); at the start of execute(), and logger.log('error', 'PROVIDER_FAILED', { ... }); in your catch blocks.
Can you do it halfway? Yes. You can add logging to one file today and another next week. The extension works perfectly fine in between.
Time estimate: 1-2 hours to add initial, high-value logging points.
3. Rate Limiting (Fix #8)
Why it's easy: This is a classic "wrapper" pattern. You create a new RateLimiter class and then wrap your existing provider calls with it. The provider adapter's internal logic remains untouched.
How to do it:
Create src/core/RateLimiter.js.
In workflow-engine.js, before this.orchestrator.executeParallelFanout(...), you would add a loop: for (const provider of providers) { await rateLimiter.acquire(provider); }.
Can you do it halfway? Yes. You can add rate limiting for just one provider (e.g., ChatGPT) and leave the others as they are.
Time estimate: 1-2 hours.
4. Performance Budgets & CI/CD Quality Gates (Fix #16 & #17)
Why it's easy: This involves zero changes to your application code. It's all about configuring your development environment (GitHub Actions, package.json).
How to do it:
Create a .github/workflows/quality-gate.yml file.
Add scripts to your package.json for lint, type-check, and test.
The workflow file will simply run these scripts.
Can you do it halfway? Yes. You can start with a CI file that only runs npm run build. You can add linting, testing, and performance budget checks later.
Time estimate: 2-3 hours to set up the initial GitHub Actions workflow.
🧠 Deep Surgery (Intertwined & High-Risk)
These changes touch the core architecture. You cannot do them halfway. The extension will be in a broken, volatile state until the refactor is complete. These require careful planning and dedicated blocks of time.
1. Service Worker Bootloader (Fix #1) - ⚠️ HIGHEST RISK
Why it's hard: This fundamentally changes the startup sequence and state initialization of your entire backend. You are re-wiring the "ignition system" of the car while the engine is running.
The process: You have to move large blocks of code around in sw-entry.js, separate eager from lazy logic, and change how every single event listener gets access to your core services.
Why you can't do it halfway: If you move the listeners but don't correctly implement the await servicesPromise pattern, every incoming message will fail because the services won't be initialized. If you half-implement the eager/lazy split, DNR rules won't be ready, or inflight resumption will break. The system is either in the old state or the new state; there is no in-between.
Time estimate: 4-6 hours of focused, uninterrupted work.
2. Persistence Layer SSOT (Fix #4) - ⚠️ HIGH RISK
Why it's hard: This is a core dependency injection refactor. You are changing how the most critical piece of state (the database connection) is created and shared across the entire application.
The process: You have to change the constructor for SessionManager, ContextResolver, WorkflowCompiler, and WorkflowEngine to accept the adapter or sessionManager as an argument. Then you have to trace every place where these classes are instantiated (new SessionManager()) and update them to pass in the singleton instance.
Why you can't do it halfway: If one part of the code is using the new singleton instance but another part is still creating its own rogue instance, you've made the race condition worse, not better. The entire application must be switched over to the dependency injection model at once.
Time estimate: 3-5 hours.
3. Data Migrations (Fix #5)
Why it's hard: While the concept is simple, implementing it correctly in IndexedDB's onupgradeneeded event is tricky and unforgiving. An error in your migration script can permanently corrupt a user's database with no easy way to recover.
The process: You need to modify src/persistence/database.ts, increment DB_VERSION, and write the migration logic inside the onupgradeneeded handler. This logic must be perfect, as it will only run once per user.
Why you can't do it halfway: Once onupgradeneeded runs, it's done. If your script was buggy, the user's database is now in a broken state. You can't "pause" a migration. It either succeeds or fails catastrophically. This requires careful local testing with a copy of an old database version before you can even think about shipping it.
Time estimate: 2-4 hours (including careful testing).
4. TypeScript Migration (Fix #10)
Why it's hard: While you can do this file-by-file, converting a core file like workflow-engine.js is not a simple rename. You will uncover dozens of implicit any types and potential type errors that you'll have to fix. This can cascade, requiring you to add types to the files that interact with it.
The process: Rename workflow-engine.js to .ts. Run the TypeScript compiler. Fix the 50+ errors it reports. This will likely involve updating types in shared/contract.ts and ui/types.ts.
Why you can't do it halfway (for a single core file): A single file must be fully type-correct to compile. You can't just fix a few errors and save. The entire file must be converted in one go.
Time estimate: 2-4 hours per core file.
Summary & Your Action Plan
Knock these out today/this week (Easy Wins):
Error Boundaries: Wrap your UI components. (Low effort, high safety).
Observability: Add the logger and sprinkle in some initial log points. (Low effort, massive future value).
Rate Limiting: Add the wrapper for provider calls. (Medium effort, protects your users).
Plan for these next (Deep Surgery):
SW Bootloader: Block out a morning or afternoon. This is your highest-priority architectural fix. Don't start it unless you have time to finish it.
Persistence SSOT: This is the second-highest priority. Tackle it after the bootloader is stable.
Data Migrations: Do this before you need to make your next schema change. Practice it locally first.

---

Tier 1: The Ambulance — Stop the Bleeding (Critical, Do These Now)
These are the fixes that prevent catastrophic, unrecoverable failures: silent crashes, data corruption, and a completely dead extension. These are the ~6 items you've been focusing on.
Service Worker Bootloader (#1):
Risk: Extension is dead on arrival for some users. (Patient is not breathing).
Error Boundaries & Silent Failures (#2):
Risk: A simple rendering bug causes a blank white screen of death. (Patient has a sudden, fatal heart attack).
Memory Management (#3):
Risk: The extension leaks memory and crashes after a few uses. (Patient is bleeding out internally).
Persistence SSOT (#4):
Risk: Race conditions corrupt the user's entire conversation history. (Patient develops a brain aneurysm).
UI Performance & State Management (#12, #13):
Risk: The UI becomes unusably slow and janky, leading to user frustration. (Patient can't walk without stumbling).
Note: I'm promoting this to Tier 1 based on your feedback. A responsive UI is a critical feature.
Dead Code Removal (#11):
Risk: Leftover code from old refactors causes unexpected bugs. (Patient has a ticking time bomb from a past surgery).
Note: Also promoted. This is a quick win that improves stability.
Tier 2: The Foundation — Structural Integrity (High Priority, Do These Next)
These fixes aren't about immediate survival, but about building a foundation that won't collapse as you add more features. They prevent long-term decay and make the system resilient.
Data Migrations (#5):
Why it's here: You're right, you have a manual process. But the first time you forget or make a mistake, you will corrupt data for thousands of users. This automates that safety.
Observability / Logging (#6):
Why it's here: You can't fix bugs you can't see. This is your "black box recorder." Without it, you are guessing.
Circuit Breakers (#7):
Why it's here: Prevents your extension from wasting resources and frustrating the user by repeatedly trying to contact a provider that is clearly down.
Rate Limiting (#8):
Why it's here: Protects your users from getting IP-banned by providers in shared network environments (like offices or universities).
Tier 3: The Upgrades — Future-Proofing & Polish (Important, But Not Urgent)
These are the professional-grade improvements that make the extension easier to maintain, faster to develop for, and more robust in the long run. You can safely defer these until the Tier 1 and 2 items are done.
TypeScript Migration (#10):
Why it's here: A massive long-term win for stability, but your app works without it today. It's a "vaccine," not emergency surgery.
Testing Infrastructure (#14):
Why it's here: Absolutely crucial for a mature project, but you can ship without a full test suite. The immediate priority is fixing the known architectural flaws.
CI/CD Quality Gates (#16):
Why it's here: This is automation that enforces quality. You need to define the quality standards (linting, testing) before you can automate them.
Performance Budgets (#17):
Why it's here: This prevents "feature bloat" over time. It's a long-term discipline, not an immediate fix.
Configuration Management (#15):
Why it's here: This is about organization and making the code cleaner. It doesn't fix a user-facing problem directly.
Arkose Isolation (#9):
Why it's here: As you said, this can be moved to later. It's a good architectural improvement for fault isolation, but not a fire that needs putting out today.
The Full Picture
So, you were right. The list is much longer. But your instinct to focus on a smaller, more critical set of problems was spot-on. Those ~6 issues are the ones that can kill your project. The rest are about ensuring it has a long and healthy life.
This tiered approach should give you a clear roadmap:
Focus all your energy on Tier 1 first. Don't even think about the others until these are done.
Then, move to Tier 2 to build a stable foundation.
Finally, sprinkle in Tier 3 improvements over time as you continue to develop new features.