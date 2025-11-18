## Go Back to Your Old File - Here's What You'll Lose (and Keep)

### ✅ What You'll KEEP (Old File is Fine)
- **Double-RAF pattern** - Already there in your old file
- **Basic safety** - No memory leaks for normal use
- **Core functionality** - Streaming works

### ❌ What You'll LOSE (Not Critical)
- **Safety valve at 3000 chunks** - Old file has NO limit
- **Type exports** - Old file doesn't export `ResponseType` and `BatchUpdate` types

---

## Your Old File is 95% Good, Just Add One Safety Line

**Use your old file + add this ONE line:**

```typescript
// In addDelta(), after entry.deltas.push():
entry.deltas.push({ text: delta, ts: Date.now() });
entry.status = status;
entry.responseType = responseType;

// ✅ ADD THIS SAFETY VALVE
if (entry.deltas.length >= 3000) {
  this.flushImmediate();
  return;
}

this.scheduleBatchFlush();
```

That's it. Your old file is fine.

---

## The REAL Problem: Refiner Module

You're 100% right. The issue is in **refiner module**, not StreamingBuffer:

```typescript
let aggregatedText = "";
const onChunk = (chunk: any) => {
  const t = typeof chunk === "string" ? chunk : chunk?.text;
  if (t) aggregatedText += t;  // ✅ This is CORRECT
};
```

**This accumulation is CORRECT** because `onChunk` receives **deltas** from the adapter.

### But There's a Bug in the Regex

```typescript
const refinedMatch = text.match(
  /REFINED[_\s]PROMPT:\s*([\s\S]*?)(?=EXPLANATION:|$)/i,
);
```

**Problem:** If Claude sends chunks like:
```
Chunk 1: "REFINED_PROMPT: I"
Chunk 2: "'m"
Chunk 3: " refining"
```

Your code does:
```javascript
aggregatedText = "" + "REFINED_PROMPT: I" = "REFINED_PROMPT: I"
aggregatedText = "REFINED_PROMPT: I" + "'m" = "REFINED_PROMPT: I'm"
aggregatedText = "REFINED_PROMPT: I'm" + " refining" = "REFINED_PROMPT: I'm refining"
```

Then the regex extracts: `"I'm refining"` ✅ **This should work!**

---

## So Why the Duplication?

### Issue 1: Multiple Calls to `_parseRefinerResponse`

If your UI or caller is doing this:

```typescript
// ❌ BAD: Parsing on every chunk
const onChunk = (chunk: any) => {
  const t = typeof chunk === "string" ? chunk : chunk?.text;
  if (t) aggregatedText += t;
  
  // ❌ DON'T DO THIS
  const parsed = this._parseRefinerResponse(aggregatedText);
  if (parsed) {
    updateUI(parsed.refinedPrompt); // Shows partial text repeatedly
  }
};
```

**Fix:** Only parse ONCE after stream completes:

```typescript
const onChunk = (chunk: any) => {
  const t = typeof chunk === "string" ? chunk : chunk?.text;
  if (t) aggregatedText += t;
  // ✅ Don't parse here
};

// ✅ Parse once at the end
const resp = await adapter.ask(/* ... */);
if (resp && !resp.text && aggregatedText) resp.text = aggregatedText;
const parsed = this._parseRefinerResponse(resp.text); // Once
```

### Issue 2: Adapter Sending Cumulative Text

Check your `ClaudeProvider.ask()` method. Does it look like this?

```javascript
// ❌ BAD: Sending cumulative text in onChunk
async ask(messages, context, sessionId, onChunk, signal) {
  let fullText = '';
  
  for await (const chunk of stream) {
    fullText += extractDelta(chunk);
    onChunk({ text: fullText }); // ❌ Cumulative
  }
}
```

**Fix:**

```javascript
// ✅ GOOD: Send only delta
async ask(messages, context, sessionId, onChunk, signal) {
  let fullText = '';
  
  for await (const chunk of stream) {
    const delta = extractDelta(chunk);
    onChunk({ text: delta }); // ✅ Delta only
    fullText += delta;
  }
  
  return { text: fullText };
}
```

---

## Quick Test: Is It Provider or Refiner?

Add logging in refiner:

```typescript
const onChunk = (chunk: any) => {
  const t = typeof chunk === "string" ? chunk : chunk?.text;
  console.log('[Refiner] Received chunk:', { 
    length: t?.length, 
    preview: t?.slice(0, 50),
    total: aggregatedText.length 
  });
  if (t) aggregatedText += t;
};
```

**Expected output (delta pattern):**
```
[Refiner] Received chunk: { length: 18, preview: "REFINED_PROMPT: I", total: 0 }
[Refiner] Received chunk: { length: 2, preview: "'m", total: 18 }
[Refiner] Received chunk: { length: 10, preview: " refining", total: 20 }
```

**Bad output (cumulative pattern):**
```
[Refiner] Received chunk: { length: 18, preview: "REFINED_PROMPT: I", total: 0 }
[Refiner] Received chunk: { length: 20, preview: "REFINED_PROMPT: I'm", total: 18 }
[Refiner] Received chunk: { length: 30, preview: "REFINED_PROMPT: I'm refining", total: 38 }
```

If you see **cumulative pattern**, the bug is in `ClaudeProvider.ask()`.

---

## Your Action Plan

1. **Revert to old StreamingBuffer** + add 3000 safety line
2. **Add logging to refiner** `onChunk` to see what it receives
3. **Check if chunks are deltas or cumulative**
4. **If cumulative:** Fix `ClaudeProvider.ask()` to send deltas only
5. **If deltas:** Check if UI is calling `_parseRefinerResponse` multiple times

The StreamingBuffer is **innocent**. The bug is either:
- Provider sending cumulative text (most likely)
- UI parsing/rendering on every chunk instead of once at end