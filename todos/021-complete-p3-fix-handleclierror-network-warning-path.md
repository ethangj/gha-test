---
status: complete
priority: p3
issue_id: "021"
tags: [code-review, bug, ux]
dependencies: ["014"]
---

# Fix `handleCliError` Network Error Path — `core.warning` Followed by Fatal `process.exit`

## Problem Statement

In `src/cli/push-pull.ts:100–104`, the network error branch calls `core.warning(...)` with a message saying "re-running is safe — push and pull are idempotent." But the function then falls through to `process.exit(1)` at line 117, making the step fail despite the warning suggesting it's recoverable. The step both warns AND fatally fails with no `core.setFailed` call — so the UI shows an exit without an error annotation.

## Findings

- `src/cli/push-pull.ts:100–104` — `core.warning(...)` on network error
- `src/cli/push-pull.ts:117` — `process.exit(1)` always called regardless of branch
- The network branch is the ONLY branch that doesn't call `core.setFailed` before `process.exit`
- Net result: workflow step fails (exit code 1) but no error annotation in Actions UI
- Message says "safe to retry" but the step is marked failed

## Proposed Solutions

### Option 1: Add `core.setFailed` to network error branch (consistent failure)

Make behavior consistent — if network errors are fatal, add `setFailed` before the existing `process.exit`. At least the Actions UI will show a proper error annotation.

**Effort:** 5 minutes
**Risk:** Low

---

### Option 2: Make network errors non-fatal (return without exiting)

**Approach:** If the intent is truly "network errors are recoverable," make the branch call `core.warning` and `return` — don't call `process.exit`. The workflow continues and a human can see the warning.

**Pros:**
- Matches the intent of the warning message

**Cons:**
- Changes exit semantics — push/pull might silently succeed with a warning

**Effort:** 5 minutes

**Risk:** Low, but behavior change

## Recommended Action

Depends on intent. If network errors should fail the step: Option 1 (add setFailed). If they should be soft warnings: Option 2. Given this is a push/pull operation where failure matters, Option 1 is safer.

Note: This todo is partially subsumed by todo 014 (replace process.exit with throw) — if that's done, all branches throw and the network branch can simply throw with a different error class/message.

## Technical Details

**Affected files:**
- `src/cli/push-pull.ts:100–117`

## Acceptance Criteria

- [ ] Network error branch calls `core.setFailed` before exit (Option 1)
- OR
- [ ] Network error branch returns without calling `process.exit` (Option 2)
- [ ] Test case added for network error in `push-pull.test.ts`

## Work Log

### 2026-03-18 - Discovery

**By:** Pattern review agent
