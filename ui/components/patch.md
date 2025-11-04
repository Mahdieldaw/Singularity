The Goal: Achieving Surgical Precision for Recompute UI

  Right now, our recompute feature has two UI bugs that create a confusing experience:

   1. When a recompute finishes, the result doesn't appear until the page is
      refreshed.
   2. When a recompute starts, all the mapping and synthesis boxes in that turn
      incorrectly show a "generating" state, not just the one being worked on.

  We are going to fix both issues by implementing a smarter, more precise real-time
  update flow. The goal is that when a user clicks to recompute a single box, only
  that box shows a loading state, and the result appears in that same box the moment
  it's ready, without affecting any other part of the UI.

  Here is how we will accomplish this, from click to final result:

  Step 1: Create a Specific "Target" for the Loading State

  First, we need to stop using a generic, global "loading" flag. We will create a new,
   highly specific state atom that knows exactly what is being recomputed.

  In our state file (ui/state/atoms.ts), we will add a new atom called
  activeRecomputeStateAtom. This atom will hold an object that describes the exact
  task in progress—which turn it's for, whether it's a 'synthesis' or 'mapping' step,
  and which provider is running—or it will be null if no recompute is happening.

  Step 2: "Aim" the Target When the User Clicks

  Next, when the user initiates the recompute, we'll immediately set this new state.

  In the hook that handles the user's click when the
  runSynthesisForRound (or mapping) function is called, we will now do two things in
  order:
   1. Set the activeRecomputeStateAtom with the details of the job: the sourceTurnId,
      the stepType, and the targetProvider.
   2. Then, send the RecomputeRequest message to the backend as usual.

  This action is like "aiming" our loading state at a specific target on the screen
  the moment the user clicks the button.

  Step 3: Teach Each Box to Recognize if It's the Target

  This is how we'll solve the "all boxes are generating" bug. We will make each
  individual result box component "self-aware."

  The component that renders a single result box
   will now read the
  activeRecomputeStateAtom. It will then compare the contents of that atom to its own
  identity (the props it receives, like its turn.id, stepType, and providerId).

  The component's logic will be simple: "If the details in the
  activeRecomputeStateAtom perfectly match my own identity, then I am the one being
  recomputed, and I will show a loading spinner. If they don't match, I will do
  nothing and continue to display my current, 'frozen' content."

  This ensures that only the single, targeted box ever enters a loading state.

  Step 4: Add the Missing "Address" to the Backend's Response

  To solve the "result doesn't appear until refresh" bug, the backend's response needs
   to include the "return address" for the result.

  In the WorkflowEngine, when a recompute step finishes, we will modify the
  WORKFLOW_STEP_UPDATE message it sends back to the UI. We will add two new properties
   to this message: isRecompute: true and, most importantly, sourceTurnId. This
  sourceTurnId tells the UI exactly which historical turn this new result belongs to.

  Step 5: Deliver the Result to the Correct "Address"

  Finally, we'll teach the UI's message handler how to read this new, smarter message.

  In ui/hooks/usePortMessageHandler.ts, when a WORKFLOW_STEP_UPDATE message arrives,
  it will first check if message.isRecompute is true.

  If it is, instead of looking for a generic "active" turn, it will use the
  message.sourceTurnId to find the exact historical turn in its state map. It will
  then update that specific turn's mappingResponses or synthesisResponses with the new
   result from the message.

  After it has successfully delivered the result to the correct turn, it will perform
  one final action: it will reset the activeRecomputeStateAtom back to null. This
  tells the UI that the recompute task is finished, which in turn causes the loading
  spinner on the targeted box to disappear, revealing the new content.

  By implementing this full flow, we create a seamless and intuitive experience that
  perfectly aligns with our new, precise backend architecture.