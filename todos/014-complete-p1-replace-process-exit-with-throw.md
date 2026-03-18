---
status: complete
priority: p1
issue_id: "014"
tags: [code-review, architecture, p1]
dependencies: []
---

# Replace `process.exit(1)` with `throw` Throughout Call Graph

## Problem Statement

`process.exit(1)` is called at 11 call sites across 4 source files as the primary error control flow mechanism. This is an architectural anti-pattern that:
1. Bypasses `await`-ed cleanup, `finally` blocks, and the post-step that stops the Docker container
2. Forces every test file to mock `process.exit` via `jest.spyOn` just to prevent the test runner from dying
3. Makes the `handleCliError` "warn on network error" intent unrealizable (warning path still calls `process.exit`)
4. Was explicitly worked around in `main.ts:185` with an inline comment about `pushPull` calling `process.exit`

## Findings

- `src/inputs.ts:129` — `process.exit(1)` after `core.setFailed`
- `src/main.ts:49,76,89,118,139,231,322` — 7 call sites
- `src/cli/push-pull.ts:63,117` — 2 call sites in `handleCliError`
- `src/cli/record-flush.ts:37,174` — 2 call sites
- `main.ts:185` — explicit comment acknowledging the problem
- All 3 test files use `jest.spyOn(process, 'exit').mockImplementation(...)` to compensate
- `handleCliError` return type `never` is correct but achieved via `process.exit` not `throw`

## Proposed Solutions

### Option 1: Introduce `ActionFatalError` class, throw everywhere

```typescript
// src/errors.ts
export class ActionFatalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActionFatalError'
  }
}

// Callers: throw new ActionFatalError('...') instead of core.setFailed + process.exit
// main.ts top-level:
run().catch(err => {
  core.setFailed(err instanceof Error ? err.message : String(err))
  process.exit(1)  // single exit point
})
```

**Pros:**
- process.exit becomes a single, controlled exit point
- All async cleanup (container stop) can happen properly
- Test mocking of process.exit no longer needed in individual test files
- `handleCliError` can throw instead of exit — making the warning branch actually warn-only

**Cons:**
- Significant refactor touching all error paths

**Effort:** 3–4 hours

**Risk:** Medium (broad change, needs comprehensive testing)

---

### Option 2: Incremental — replace in `handleCliError` first

**Approach:** Start with `handleCliError` since it's the most impactful case (the warning bypass issue), then incrementally replace others.

**Pros:**
- Lower risk per step
- Delivers the most critical fix first (warning path works correctly)

**Cons:**
- Process.exit still exists in other places

**Effort:** 1 hour per phase

**Risk:** Low per phase

## Recommended Action

Option 2 — start with `handleCliError`. Change it from `never` + `process.exit` to throwing typed errors. Then tackle `inputs.ts` (make `getInputs()` throw instead of exit). Then clean up `main.ts`.

## Technical Details

**Affected files:**
- `src/cli/push-pull.ts` — `handleCliError` should `throw` not `process.exit`
- `src/cli/record-flush.ts` — error paths should `throw`
- `src/inputs.ts` — `getInputs()` should `throw` not `process.exit`
- `src/main.ts` — several error paths
- All test files — remove `jest.spyOn(process, 'exit')` mocking once done

## Acceptance Criteria

- [ ] `handleCliError` returns `never` via `throw` not `process.exit`
- [ ] No test file needs `jest.spyOn(process, 'exit')` anymore
- [ ] Docker container properly stopped when run command fails (cleanup in post-step)
- [ ] `handleCliError` network error warning path actually returns (doesn't exit)
- [ ] All 73 existing tests pass

## Work Log

### 2026-03-18 - Discovery

**By:** Architecture review agent

**Notes:**
- `main.ts:185` comment is a smoking gun — the codebase already acknowledges this problem
- Network error branch in `handleCliError` emits `core.warning` but then still calls `process.exit(1)` at line 117 — the "transient, retry-safe" intent is never realized
