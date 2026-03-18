---
status: complete
priority: p3
issue_id: "020"
tags: [code-review, dead-code]
dependencies: []
---

# Remove Unused `_workspace` Parameter from `runEphemeralMode`

## Problem Statement

`src/main.ts:68` — `runEphemeralMode` has an `_workspace: string` parameter that is never used in the function body. It was presumably added speculatively and the underscore prefix was added to suppress the TypeScript unused-variable warning.

## Findings

- `src/main.ts:68` — `_workspace: string` parameter, never referenced in function body
- `src/main.ts:54` — call site passes `workspace` as the third argument
- Workspace access is already available via `process.env.GITHUB_WORKSPACE ?? process.cwd()` if ever needed inside the function

## Proposed Solutions

### Option 1: Remove the parameter

Remove `_workspace: string` from the function signature and `workspace` from the call site.

**Effort:** 5 minutes
**Risk:** Low

## Recommended Action

Option 1 — straightforward dead code removal.

## Technical Details

**Affected files:**
- `src/main.ts:54` (call site)
- `src/main.ts:68` (function signature)

## Acceptance Criteria

- [ ] `_workspace` parameter removed from `runEphemeralMode`
- [ ] Call site updated
- [ ] TypeScript compiles clean
- [ ] Tests pass

## Work Log

### 2026-03-18 - Discovery

**By:** Pattern + simplicity review agents
