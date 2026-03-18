---
status: pending
priority: p3
issue_id: "007"
tags: [code-review, testing]
dependencies: []
---

# Add Missing Test Coverage for `lifecycle.ts`, `installer.ts`, `main.ts`, `summary.ts`

## Problem Statement

73 tests exist across 6 test files but several critical modules have zero test coverage: `lifecycle.ts` (Docker container management), `installer.ts` (CLI installation), `main.ts` (orchestration), and `summary.ts` (job summary writing).

## Findings

- `src/container/lifecycle.ts` — `startContainer`, `waitForHealth`, `stopContainer` — zero tests
- `src/cli/installer.ts` — `installCli`, `configureToken` — zero tests
- `src/main.ts` — main orchestration logic — zero tests
- `src/summary.ts` — `writeSummary` — zero tests
- Existing tests cover: retry, yaml-reader, port-resolver, inputs, record-flush, push-pull

## Proposed Solutions

### Option 1: Add tests for each module (unit style with mocks)

**Approach:** Create test files:
- `src/__tests__/container/lifecycle.test.ts`
- `src/__tests__/cli/installer.test.ts`
- `src/__tests__/main.test.ts`
- `src/__tests__/summary.test.ts`

Mock `@actions/exec`, `@actions/core`, and `node-fetch` as needed.

**Pros:**
- Increases confidence in core orchestration code

**Cons:**
- `main.ts` is integration-heavy; unit tests may not add much value
- `summary.ts` uses `core.summary` which requires mock

**Effort:** 4–8 hours

**Risk:** Low

## Recommended Action

Start with `lifecycle.ts` (testable with exec mocks) and `installer.ts`. `main.ts` and `summary.ts` can follow.

## Technical Details

**Affected files (new):**
- `src/__tests__/container/lifecycle.test.ts`
- `src/__tests__/cli/installer.test.ts`
- `src/__tests__/summary.test.ts`

**Patterns to follow:** See `src/__tests__/cli/record-flush.test.ts` for exec mock patterns.

## Acceptance Criteria

- [ ] `lifecycle.ts` has tests for startContainer, waitForHealth (success + timeout), stopContainer
- [ ] `installer.ts` has tests for installCli, configureToken
- [ ] `summary.ts` has tests for writeSummary (with and without URLs)
- [ ] All new tests pass

## Work Log

### 2026-03-18 - Discovery

**By:** Claude Code review
