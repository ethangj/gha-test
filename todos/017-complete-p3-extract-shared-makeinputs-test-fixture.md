---
status: complete
priority: p3
issue_id: "017"
tags: [code-review, testing, refactor]
dependencies: []
---

# Extract Shared `makeInputs` Test Fixture

## Problem Statement

`makeInputs(overrides)` factory is duplicated identically in both `src/__tests__/cli/push-pull.test.ts` and `src/__tests__/cli/record-flush.test.ts`. If `Inputs` type gains a required field, both factories must be updated independently.

## Findings

- `src/__tests__/cli/push-pull.test.ts:32–49` — `makeInputs` factory
- `src/__tests__/cli/record-flush.test.ts:25–42` — identical `makeInputs` factory
- Both define the same default values for all 13 input fields

## Proposed Solutions

### Option 1: Extract to `src/__tests__/fixtures/inputs.ts`

```typescript
// src/__tests__/fixtures/inputs.ts
export function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
  return {
    'api-token': 'test-token',
    'wiremock-dir': '.wiremock',
    'runner-admin-url': 'http://localhost:9999',
    // ...all defaults
    ...overrides,
  } as Inputs
}
```

**Effort:** 20 minutes

**Risk:** Low

## Recommended Action

Option 1 — simple extract with no behavior change.

## Technical Details

**Affected files:**
- `src/__tests__/fixtures/inputs.ts` (new)
- `src/__tests__/cli/push-pull.test.ts`
- `src/__tests__/cli/record-flush.test.ts`

## Acceptance Criteria

- [ ] Single `makeInputs` factory in `src/__tests__/fixtures/inputs.ts`
- [ ] Both test files import from fixture
- [ ] All 73 tests pass

## Work Log

### 2026-03-18 - Discovery

**By:** Architecture review agent
