---
status: complete
priority: p2
issue_id: "012"
tags: [code-review, security, input-validation]
dependencies: []
---

# Add Character Validation for `mock-api` and `profile` Inputs

## Problem Statement

`mock-api` and `profile` are passed as positional CLI arguments and used in filename construction without character validation. Values like `--token override` (flag injection) or `../secrets` (path manipulation) could affect behavior of the `wiremock` CLI or constructed file paths.

## Findings

- `src/inputs.ts` — `'mock-api': z.string().optional()` — no format constraint
- `src/inputs.ts` — `profile: z.string().optional()` — no format constraint
- `src/cli/push-pull.ts:23` — `args.push(inputs['mock-api'])` — positional arg, flag injection risk
- `src/cli/push-pull.ts:27` — `args.push('--profile', inputs.profile)` — flag injection risk
- `src/utils/yaml-reader.ts:38` — `` `wiremock-${profile}.yaml` `` — profile in filename
- A value starting with `--` becomes an unintended CLI flag to the `wiremock` binary

## Proposed Solutions

### Option 1: Add Zod `.refine()` with alphanumeric-plus-hyphen pattern

```typescript
const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

'mock-api': z.string().optional()
  .refine(v => !v || NAME_PATTERN.test(v), 'mock-api must contain only letters, numbers, hyphens, and underscores'),
profile: z.string().optional()
  .refine(v => !v || NAME_PATTERN.test(v), 'profile must contain only letters, numbers, hyphens, and underscores'),
```

**Pros:**
- Blocks flag injection and path separators
- Consistent with how environment/profile names are used in WireMock Cloud

**Cons:**
- If any legitimate API names use dots or other chars, this would need adjustment

**Effort:** 30 minutes

**Risk:** Low

## Recommended Action

Option 1 — add Zod refinements. Also validates `include-services` elements (add F-14 fix here too).

## Technical Details

**Affected files:**
- `src/inputs.ts`
- `src/__tests__/inputs.test.ts` (new test cases)

## Acceptance Criteria

- [ ] `mock-api: '--token override'` fails validation
- [ ] `profile: '../../../etc'` fails validation
- [ ] `profile: 'development'` passes
- [ ] `profile: 'my-profile-1'` passes
- [ ] Tests added

## Work Log

### 2026-03-18 - Discovery

**By:** Security review agent
