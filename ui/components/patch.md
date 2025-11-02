You're right, that's much cleaner! Here are just the diffs:

## Diff 1: Collapsed Unify Dropdown - Power User Mode (around line 280)

**REMOVE these lines:**
```typescript
const isDisabled = mapProviderId === provider.id; // Keep gating for multi-select
```
```typescript
cursor: isDisabled ? 'not-allowed' : 'pointer',
opacity: isDisabled ? 0.5 : 1,4
```typescript
if (isDisabled || isLoading) return;
```
```typescript
disabled={isDisabled || isLoading}
```

**ADD after `if (isLoading) return;`:**
```typescript
const clickedId = provider.id;
// If selecting same as Map, auto-switch Map to fallback
if (mapProviderId === clickedId && !isSelected) {
  const selectedIds = LLM_PROVIDERS_CONFIG.map(p => p.id).filter(id => selectedModels[id]);
  const prefer = clickedId === 'gemini' ? ['qwen'] : clickedId === 'qwen' ? ['gemini'] : ['qwen', 'gemini'];
  let fallback: string | null = null;
  for (const cand of prefer) {
    if (cand !== clickedId && selectedIds.includes(cand)) { fallback = cand; break; }
  }
  if (!fallback) {
    const anyOther = selectedIds.find(id => id !== clickedId) || null;
    fallback = anyOther;
  }
  onSetMappingProvider?.(fallback);
  try {
    if (fallback) {
      localStorage.setItem('htos_mapping_provider', fallback);
    } else {
      localStorage.removeItem('htos_mapping_provider');
    }
  } catch {}
}

onToggleSynthesisProvider?.(clickedId);
```

**REPLACE:**
```typescript
!isLoading && onToggleSynthesisProvider?.(provider.id);
```

---

## Diff 2: Collapsed Unify Dropdown - Single Select Mode (around line 340)

**REMOVE these lines:**
```typescript
const isDisabled = mapProviderId === provider.id;
```
```typescript
cursor: isDisabled ? 'not-allowed' : 'pointer',
opacity: isDisabled ? 0.5 : 1,
```
```typescript
onMouseEnter={(e) => {
  if (!isDisabled) e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
}}
```

**REPLACE with:**
```typescript
onMouseEnter={(e) => {
  e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
}}
```

---

## Diff 3: Expanded Unify Section - Power User Mode (around line 650)

**REMOVE this line:**
```typescript
.filter(p => mapProviderId !== p.id) // Exclude current map
```

**REPLACE:**
```typescript
onChange={() => !isLoading && onToggleSynthesisProvider?.(provider.id)}
```

**WITH:**
```typescript
onChange={() => {
  if (isLoading) return;
  const clickedId = provider.id;
  // If selecting same as Map, auto-switch Map to fallback
  if (mapProviderId === clickedId && !isSelected) {
    const selectedIds = LLM_PROVIDERS_CONFIG.map(p => p.id).filter(id => selectedModels[id]);
    const prefer = clickedId === 'gemini' ? ['qwen'] : clickedId === 'qwen' ? ['gemini'] : ['qwen', 'gemini'];
    let fallback: string | null = null;
    for (const cand of prefer) {
      if (cand !== clickedId && selectedIds.includes(cand)) { fallback = cand; break; }
    }
    if (!fallback) {
      const anyOther = selectedIds.find(id => id !== clickedId) || null;
      fallback = anyOther;
    }
    onSetMappingProvider?.(fallback);
    try {
      if (fallback) {
        localStorage.setItem('htos_mapping_provider', fallback);
      } else {
        localStorage.removeItem('htos_mapping_provider');
      }
    } catch {}
  }
  onToggleSynthesisProvider?.(clickedId);
}}
```

That's it! These 3 sets of changes remove all the gating logic and add the smart auto-switching behavior.