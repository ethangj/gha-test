---
status: complete
priority: p2
issue_id: "005"
tags: [code-review, bug, quality]
dependencies: []
---

# Fix `retry.ts` Zero-Retries Bug

## Problem Statement

In `src/utils/retry.ts`, if `retries: 0` is passed, the `for` loop never executes (condition `1 <= 0` is false) and the "unreachable" throw at the bottom is reached. This throws a generic "Retry exhausted" error when the caller intended to call the function zero times.

## Findings

- `src/utils/retry.ts:13` — `for (let attempt = 1; attempt <= retries; attempt++)`
- With `retries: 0`: loop body never runs, falls through to `throw new Error('Retry exhausted')`
- With `retries: 1`: loop runs once, throws the original error if it fails — correct
- Called from `src/container/lifecycle.ts` with `inputs['health-check-retries']` (default: 30) — so not currently hit in practice, but defensive fix is warranted

## Proposed Solutions

### Option 1: Guard against `retries < 1`

```typescript
if (retries < 1) {
  return await fn()
}
```

Add this before the loop so zero retries means "call once with no retry".

**Effort:** 10 minutes
**Risk:** Low

---

### Option 2: Change loop to `do...while`

```typescript
let attempt = 0
do {
  attempt++
  try { return await fn() }
  catch (err) {
    if (attempt >= retries) throw err
    // ...
  }
} while (attempt < retries)
```

More complex, same fix.

**Effort:** 15 minutes
**Risk:** Low

## Recommended Action

Option 1 — add guard before the loop. Simplest and most readable.

## Technical Details

**Affected files:**
- `src/utils/retry.ts:13`

## Acceptance Criteria

- [ ] `retry(fn, { retries: 0, ... })` calls `fn` once and returns/throws its result
- [ ] Existing retry behavior unchanged for `retries >= 1`
- [ ] Test added for `retries: 0` case

## Work Log

### 2026-03-18 - Discovery

**By:** Claude Code review
