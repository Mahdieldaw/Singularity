# Production-Grade State Refactoring: Implementation Guide

## 🎯 Mission Objective
Eliminate scroll-locking and re-render cascades during streaming by implementing surgical, atomic state updates.

## 🏗️ Architecture Overview

### The Problem (Before)
```
messagesAtom (array of all turns)
    ↓
  [every streaming update creates new array ref]
    ↓
  ChatView re-renders
    ↓
  All MessageRow components re-render
    ↓
  All AiTurnBlock components re-render
    ↓
  All ProviderResponseBlock components re-render
    ↓
  RESULT: O(n) re-renders per streaming chunk = scroll thrash
```

### The Solution (After)
```
turnsMapAtom (Map<turnId, Turn>)
    ↓
  [streaming update mutates ONE Map entry via Immer]
    ↓
  ChatView: NO RE-RENDER (subscribes to turnIdsAtom only)
    ↓
  MessageRow: NO RE-RENDER (stable turnId prop)
    ↓
  AiTurnBlockConnected: NO RE-RENDER (stable props)
    ↓
  ProviderResponseBlockConnected: RE-RENDERS (isolated subscription)
    ↓
  RESULT: O(1) re-render per streaming chunk = smooth scrolling
```

## 📋 Implementation Checklist

### Phase 1: State Layer Foundation
- [x] `atoms.ts` - Create `turnsMapAtom`, `turnIdsAtom`, `providerResponsesForTurnAtom`
- [x] `turn-helpers.ts` - Ensure helpers work with in-place Immer mutations

### Phase 2: Write Path Migration
- [x] `useChat.ts` - Replace array mutations with Map.set() + array.push()
- [x] `usePortMessageHandler.ts` - Surgical Map updates for streaming
- [x] `useInitialization.ts` - Clear Map instead of array

### Phase 3: Read Path Refactoring
- [x] `ChatView.tsx` - Subscribe to turnIdsAtom only
- [x] `MessageRow.tsx` - Derive Turn from Map via turnId
- [x] `UserTurnBlockConnected.tsx` - Symmetric ID pattern
- [x] `AiTurnBlockConnected.tsx` - Delegate turnId to children

### Phase 4: Isolated Subscription (Critical)
- [x] `ProviderResponseBlockConnected.tsx` - NEW FILE, isolated subscription
- [x] `AiTurnBlock.tsx` - Accept children prop for composition

## 🔧 File-by-File Implementation Order

### 1. atoms.ts
**Replace entire file** with the new atomic primitives.

**Key Changes:**
- `turnsMapAtom` replaces `messagesAtom` as primary store
- `turnIdsAtom` provides structural stability
- `messagesAtom` becomes derived (backward compat)
- `providerResponsesForTurnAtom` enables surgical subscriptions

**Validation:**
```typescript
// In browser console after update:
import { turnsMapAtom, turnIdsAtom } from './state/atoms';
// Should work without errors
```

---

### 2. turn-helpers.ts
**Replace entire file** - no changes to API, just documentation updates.

**Key Changes:**
- Added comments explaining Immer mutation pattern
- No functional changes needed

---

### 3. useChat.ts
**Replace entire file** with Map-based mutations.

**Key Changes:**
```typescript
// OLD:
setMessages((draft) => { draft.push(userTurn, aiTurn); });

// NEW:
setTurnsMap((draft) => {
  draft.set(userTurn.id, userTurn);
  draft.set(aiTurn.id, aiTurn);
});
setTurnIds((draft) => {
  draft.push(userTurn.id, aiTurn.id);
});
```

**Validation:**
- Send a message → should appear in chat
- Check browser DevTools → should see Map in state

---

### 4. usePortMessageHandler.ts
**Replace entire file** with surgical Map updates.

**Key Changes:**
```typescript
// OLD:
setMessages((draft) => {
  const aiTurn = draft.find(t => t.id === activeId);
  if (aiTurn) applyStreamingUpdates(aiTurn, updates);
});

// NEW:
setTurnsMap((draft) => {
  const aiTurn = draft.get(activeId);
  if (aiTurn) applyStreamingUpdates(aiTurn as AiTurn, updates);
});
```

**Validation:**
- Send a message → should stream correctly
- Watch console for `[Port Handler]` logs

---

### 5. useInitialization.ts
**Replace entire file** with Map-based reset.

**Key Changes:**
```typescript
// OLD:
setMessages([]);

// NEW:
setTurnsMap((draft) => { draft.clear(); });
setTurnIds((draft) => { draft.length = 0; });
```

**Validation:**
- Refresh app → should start with empty chat
- No errors in console

---

### 6. ChatView.tsx
**Replace entire file** - critical performance change.

**Key Changes:**
```typescript
// OLD:
const [messages] = useAtom(messagesAtom);
<Virtuoso data={messages} ... />

// NEW:
const [turnIds] = useAtom(turnIdsAtom);
<Virtuoso data={turnIds} ... />
```

**Validation:**
- Open DevTools React Profiler
- Send a streaming message
- ChatView should NOT re-render during streaming

---

### 7. MessageRow.tsx
**Replace entire file** - implements derived accessor pattern.

**Key Changes:**
```typescript
// OLD:
function MessageRow({ message }: { message: TurnMessage }) { ... }

// NEW:
function MessageRow({ turnId }: { turnId: string }) {
  const turnAtom = useMemo(() => atom((get) => get(turnsMapAtom).get(turnId)), [turnId]);
  const message = useAtomValue(turnAtom);
  ...
}
```

**Validation:**
- Messages should render correctly
- Click profiler → MessageRow for non-streaming turns should NOT re-render

---

### 8. UserTurnBlockConnected.tsx
**Replace entire file** - symmetrical pattern for completeness.

**Key Changes:**
- Now accepts `turnId` prop
- Minimal functional change, just API consistency

**Validation:**
- User messages should render correctly
- No errors in console

---

### 9. ProviderResponseBlockConnected.tsx
**CREATE NEW FILE** - this is the critical isolation layer.

**Key Changes:**
- NEW component that creates isolated subscription
- Only this component re-renders during streaming

**Validation:**
- Profile a streaming message
- Only ProviderResponseBlockConnected should re-render
- Parent AiTurnBlockConnected should be stable

---

### 10. AiTurnBlockConnected.tsx
**Replace entire file** - now delegates to ProviderResponseBlockConnected.

**Key Changes:**
```typescript
// OLD:
<AiTurnBlock aiTurn={aiTurn} providerResponses={responses} ... />

// NEW:
<AiTurnBlock aiTurn={aiTurn} ...>
  <ProviderResponseBlockConnected aiTurnId={aiTurn.id} />
</AiTurnBlock>
```

**Validation:**
- Sources should toggle correctly
- Profiler → AiTurnBlockConnected should NOT re-render during streaming

---

### 11. AiTurnBlock.tsx
**Update the file** - accept children prop.

**Key Changes:**
```typescript
// Add to props:
children?: React.ReactNode;

// Render children where ProviderResponseBlock was:
{showSourceOutputs && children}
```

**Validation:**
- Source outputs should display correctly
- Synthesis/mapping carousels still work

---

## ✅ Post-Implementation Validation

### Performance Metrics
Open React DevTools Profiler:

1. **Before refactor baseline:**
   - Send a 3-provider streaming message
   - Record flamegraph
   - Count re-renders of ChatView, MessageRow, AiTurnBlock
   - Expected: 50-100+ component re-renders per second

2. **After refactor target:**
   - Send same 3-provider streaming message
   - Record flamegraph
   - Expected: ONLY ProviderResponseBlockConnected re-renders
   - Target: <5 component re-renders per second

### Functional Validation
- [ ] Send new message → displays correctly
- [ ] Streaming works → text appears smoothly
- [ ] Scroll during streaming → NO LOCK
- [ ] Synthesis works → displays in carousel
- [ ] Mapping works → displays in carousel
- [ ] Source toggle works → shows/hides batch responses
- [ ] History load works → past sessions display
- [ ] Composer mode works → can extract to canvas

### Edge Cases
- [ ] Send message with 0 providers selected → error handled
- [ ] Send message with 1 provider → no synthesis/mapping
- [ ] Send message with 5 providers → all stream correctly
- [ ] Load session with 100+ turns → Virtuoso handles it
- [ ] Rapid-fire send multiple messages → queue handled
- [ ] Close tab during streaming → no crashes on reconnect

---

## 🐛 Debugging Guide

### If streaming doesn't work:
```typescript
// Add to usePortMessageHandler.ts PARTIAL_RESULT handler:
console.log('[DEBUG] Streaming update:', {
  stepType,
  providerId: pid,
  activeId: activeAiTurnIdRef.current,
  chunkLength: chunk.text.length
});

// Add to StreamingBuffer callback:
console.log('[DEBUG] Flushing buffer:', {
  updateCount: updates.length,
  activeId
});
```

### If re-renders still cascade:
```typescript
// Add to MessageRow.tsx:
useEffect(() => {
  console.log(`[PERF] MessageRow ${turnId} rendered`);
});

// Add to ProviderResponseBlockConnected.tsx:
useEffect(() => {
  console.log(`[PERF] ProviderResponseBlockConnected ${aiTurnId} rendered`);
});
```

Open React DevTools Profiler, look for yellow/red components.

### If Map state looks wrong:
```typescript
// In browser console:
import { useAtomValue } from 'jotai';
import { turnsMapAtom, turnIdsAtom } from './state/atoms';

// In a component:
const map = useAtomValue(turnsMapAtom);
const ids = useAtomValue(turnIdsAtom);
console.log('Map size:', map.size);
console.log('IDs length:', ids.length);
console.log('Map keys:', Array.from(map.keys()));
console.log('IDs:', ids);
```

---

## 📊 Success Metrics

### Performance (Quantitative)
- ✅ Scroll FPS: 60fps during streaming (was 10-20fps)
- ✅ Component re-renders: <5/sec (was 50-100/sec)
- ✅ Memory: Stable Map size (no leaks)
- ✅ Time to Interactive: <100ms after message send

### Developer Experience (Qualitative)
- ✅ Clean architecture: Map as single source of truth
- ✅ Predictable patterns: ID-based composition everywhere
- ✅ Debuggable: Easy to trace state changes
- ✅ Extensible: Adding new response types is trivial

---

## 🚀 Post-Deployment Optimization Opportunities

Once the refactor is live and stable, consider:

1. **Virtualization tuning:**
   - Adjust `increaseViewportBy` based on real usage
   - Implement windowing for synthesis/mapping carousels

2. **Memoization audit:**
   - Add `React.memo` to ClipsCarousel if needed
   - Review all useCallback deps

3. **Persistence layer:**
   - Sync turnsMapAtom to IndexedDB for offline
   - Implement undo/redo using Map snapshots

4. **Developer tools:**
   - Build Redux DevTools-style time-travel debugger
   - Add performance monitoring hooks

---

## 📝 Architectural Principles Established

This refactoring establishes these patterns as the foundation:

1. **Normalized State:**
   - Map<ID, Entity> + Array<ID> pattern
   - Single source of truth
   - O(1) lookups

2. **Surgical Subscriptions:**
   - Parameterized selector atoms
   - Isolated component subscriptions
   - No cascading re-renders

3. **ID-Based Composition:**
   - Pass IDs down, pull data via atoms
   - Stable props enable memoization
   - Clear data flow direction

4. **Connected/Presentational Split:**
   - Connected = smart, handles state/actions
   - Presentational = dumb, renders props
   - Easy to test, easy to reason about

**Anyone building on this codebase should follow these patterns for all new features.**

---

## ❓ FAQ

**Q: Why Map instead of object?**
A: Map has O(1) get/set/delete, maintains insertion order, and works better with Immer's structural sharing.

**Q: Why not use Recoil/Redux/Zustand?**
A: Jotai is already in place and provides atomic subscriptions out of the box. No need to add another library.

**Q: What if I need to add a new response type?**
A: Add it to the AiTurn interface, update applyStreamingUpdates/applyCompletionUpdate in turn-helpers.ts, create a new selector atom if needed, and create a connected component. The pattern is established.

**Q: Can I still use the old messagesAtom?**
A: Yes, it's derived for backward compatibility. But DON'T use setMessages - always use setTurnsMap + setTurnIds.

**Q: How do I add a new turn type?**
A: Add it to TurnMessage union, create a factory function like createOptimisticAiTurn, update MessageRow routing, create a connected component following the ID pattern.

---

## 🎓 Learning Resources

If you want to understand the patterns deeper:

- **Normalized State:** https://redux.js.org/usage/structuring-reducers/normalizing-state-shape
- **Jotai Atoms:** https://jotai.org/docs/core/atom
- **Immer Producers:** https://immerjs.github.io/immer/produce
- **React.memo:** https://react.dev/reference/react/memo
- **Virtuoso:** https://virtuoso.dev/
