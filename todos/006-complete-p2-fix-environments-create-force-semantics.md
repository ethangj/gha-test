---
status: complete
priority: p2
issue_id: "006"
tags: [code-review, bug, ux]
dependencies: []
---

# Fix Inverted `force` Flag Semantics in `environments-create`

## Problem Statement

In `src/cli/push-pull.ts:57`, the `force` flag has inverted semantics compared to user expectations. When `force: true`, the action **fails** if the profile already exists. When `force: false` (default), it silently skips. This is backwards — users typically expect `force: true` to overwrite/recreate.

## Findings

- `src/cli/push-pull.ts:57-68` — `if (inputs.force)` → setFailed + exit; `else` → skip with notice
- Test `src/__tests__/cli/push-pull.test.ts:152` confirms: `force: true + file exists → setFailed`
- `force: false + file exists → notice + skip` — this is the SAFE default, which is correct
- But `force: true` should mean "force recreation" not "hard fail"
- The WireMock CLI itself doesn't support `--force` on `environments create`, so overwriting is not possible
- The current behavior protects against accidental overwrites but the flag name is misleading

## Proposed Solutions

### Option 1: Rename `force` to `fail-if-exists` and update docs

**Approach:** Rename the input so its behavior matches its name. `fail-if-exists: true` → fail when profile exists.

**Pros:**
- Semantics match the behavior
- No behavior change, just rename

**Cons:**
- Breaking change for existing users of `force: true`
- Requires `action.yml` update

**Effort:** 30 minutes
**Risk:** Medium (breaking change)

---

### Option 2: Remove `force` flag entirely (default to skip)

**Approach:** The idempotent skip behavior is the only sensible default. Remove `force` flag. Document that the command is always idempotent.

**Pros:**
- Simpler API surface
- No confusing flag

**Cons:**
- Removes the "fail loudly if exists" escape hatch

**Effort:** 20 minutes
**Risk:** Low (if no current users depend on `force: true`)

---

### Option 3: Keep current behavior, improve documentation

**Approach:** Add a clear description in `action.yml` and README explaining that `force: true` means "fail if already exists" (a safety guard against accidental re-creation).

**Pros:**
- No behavior/breaking change

**Cons:**
- Counter-intuitive API remains

**Effort:** 15 minutes
**Risk:** Low

## Recommended Action

Review current usage. If no documented use case for `force: true`, go with Option 2 and simplify. Otherwise, Option 3 with better docs.

## Technical Details

**Affected files:**
- `src/cli/push-pull.ts:57-68`
- `src/inputs.ts` (force input definition)
- `action.yml` (input description)
- `README.md`
- `src/__tests__/cli/push-pull.test.ts:152`

## Acceptance Criteria

- [ ] `force` flag semantics documented clearly, or renamed/removed
- [ ] Tests updated to match new semantics
- [ ] README updated

## Work Log

### 2026-03-18 - Discovery

**By:** Claude Code review
