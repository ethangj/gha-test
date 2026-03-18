---
status: complete
priority: p2
issue_id: "001"
tags: [code-review, quality, dead-code]
dependencies: []
---

# Delete Dead `logger.ts` Utility

## Problem Statement

`src/utils/logger.ts` is a thin wrapper around `@actions/core` that is never imported anywhere in the codebase. It adds no value and creates confusion about whether it should be used.

## Findings

- `src/utils/logger.ts` — 6-function wrapper (notice, info, warning, error, group) around `@actions/core` with no logic
- `grep -rn "logger" src/ --include="*.ts"` returns zero results outside `logger.ts` itself
- Every file imports `@actions/core` directly instead
- No value add: functions are 1:1 re-exports with no added behavior

## Proposed Solutions

### Option 1: Delete the file

**Approach:** Simply delete `src/utils/logger.ts`.

**Pros:**
- Reduces confusion about which import to use
- Smaller codebase

**Cons:**
- None (unused code)

**Effort:** 5 minutes

**Risk:** Low

## Recommended Action

Delete `src/utils/logger.ts`. No callers need updating.

## Technical Details

**Affected files:**
- `src/utils/logger.ts` — delete this file

## Acceptance Criteria

- [ ] `src/utils/logger.ts` deleted
- [ ] `npm run build` passes
- [ ] `npm test` passes

## Work Log

### 2026-03-18 - Discovery

**By:** Claude Code review

**Actions:**
- Confirmed zero imports of logger.ts across all source files
