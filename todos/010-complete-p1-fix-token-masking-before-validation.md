---
status: complete
priority: p1
issue_id: "010"
tags: [code-review, security, p1]
dependencies: []
---

# Fix Token Masking Order — Mask Before `getInputs()` Validation

## Problem Statement

`src/main.ts:33–38` calls `getInputs()` first (which runs Zod validation and may call `core.setFailed` with error details), then calls `core.setSecret(inputs['api-token'])`. If another input field fails Zod validation while `api-token` is present, `setFailed` may log an error payload containing the raw token before it has been masked.

## Findings

- `src/main.ts:33` — `const inputs = getInputs()` runs Zod, may call `setFailed(JSON.stringify(errors))`
- `src/main.ts:36–38` — `core.setSecret(inputs['api-token'])` called AFTER getInputs() succeeds
- Zod error format includes field values in some error payloads
- If `api-token` is valid but another field is invalid, the Zod error may log `api-token` in plaintext

## Proposed Solutions

### Option 1: Read and mask raw token before full validation

```typescript
const rawToken = core.getInput('api-token')
if (rawToken) {
  core.setSecret(rawToken)
}
const inputs = getInputs()  // full Zod validation after masking
```

**Pros:**
- Token masked before any validation error could log it
- Simple, minimal change

**Cons:**
- Token masking happens before Zod validates the token format (acceptable)

**Effort:** 10 minutes

**Risk:** Low

## Recommended Action

Option 1 — add the raw token read + mask at the very start of `runMainStep`, before `getInputs()`.

## Technical Details

**Affected files:**
- `src/main.ts:33–38`

## Acceptance Criteria

- [ ] `core.setSecret` called on raw api-token value BEFORE `getInputs()` runs
- [ ] Tests pass
- [ ] TypeScript compiles clean

## Work Log

### 2026-03-18 - Discovery

**By:** Security review agent
