---
status: pending
priority: p2
issue_id: "002"
tags: [code-review, testing, dead-code]
dependencies: []
---

# Migrate or Delete Orphaned `tests/unit/` Directory

## Problem Statement

The `tests/unit/` directory contains 4 test files that are silently not running because `jest.config.ts` only picks up `src/__tests__/**/*.test.ts`. This provides false confidence that these tests are passing.

## Findings

- `tests/unit/` contains: `inputs.test.ts`, `yaml-reader.test.ts`, `port-resolver.test.ts`, `post-step.test.ts`
- `jest.config.ts` testMatch: `['**/src/__tests__/**/*.test.ts']` — excludes `tests/unit/`
- `src/__tests__/` already has equivalent coverage for inputs, yaml-reader, port-resolver
- `tests/unit/post-step.test.ts` may test post-step functionality not yet covered in `src/__tests__/`

## Proposed Solutions

### Option 1: Delete all 4 files

**Approach:** Delete `tests/unit/` entirely since `src/__tests__/` now has equivalent coverage.

**Pros:**
- Clean, no confusion
- If tests were stale/outdated, avoids migrating bad tests

**Cons:**
- May lose unique test cases from `post-step.test.ts` if it covers things `src/__tests__/` doesn't

**Effort:** 10 minutes

**Risk:** Low (check post-step coverage first)

---

### Option 2: Migrate unique tests to `src/__tests__/`

**Approach:** Review each file for unique test cases not present in `src/__tests__/`. Migrate unique ones. Delete the rest.

**Pros:**
- Preserves any unique test scenarios

**Cons:**
- More effort; tests may be outdated

**Effort:** 30–60 minutes

**Risk:** Low

## Recommended Action

Check `tests/unit/post-step.test.ts` for anything not covered in `src/__tests__/`. If there are unique cases, migrate them. Delete all 4 files afterward.

## Technical Details

**Affected files:**
- `tests/unit/inputs.test.ts` — equivalent in `src/__tests__/inputs.test.ts`
- `tests/unit/yaml-reader.test.ts` — equivalent in `src/__tests__/utils/yaml-reader.test.ts`
- `tests/unit/port-resolver.test.ts` — equivalent in `src/__tests__/container/port-resolver.test.ts`
- `tests/unit/post-step.test.ts` — check for unique coverage

## Acceptance Criteria

- [ ] `tests/unit/` directory removed
- [ ] Any unique test cases from `post-step.test.ts` migrated to `src/__tests__/`
- [ ] `npm test` passes with no regressions

## Work Log

### 2026-03-18 - Discovery

**By:** Claude Code review

**Actions:**
- Confirmed jest.config.ts testMatch excludes `tests/unit/`
- Identified 4 orphaned test files
