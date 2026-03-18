---
status: complete
priority: p3
issue_id: "004"
tags: [code-review, type-safety]
dependencies: []
---

# Fix `process.env` Unsafe Cast in `exec.ts`

## Problem Statement

`src/container/exec.ts:20` casts `process.env` to `Record<string, string>` which hides the fact that environment variable values can be `undefined`. This could silently pass `undefined` values into the child process environment.

## Findings

- `src/container/exec.ts:20` — `...(process.env as Record<string, string>)`
- `process.env` is `Record<string, string | undefined>` — the cast silences TypeScript
- In practice, `exec` ignores `undefined` values, but the cast is misleading

## Proposed Solutions

### Option 1: Filter undefined values explicitly

```typescript
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
)
```

**Effort:** 15 minutes
**Risk:** Low

---

### Option 2: Use `Object.assign({}, process.env, env)` and let exec handle it

**Approach:** Pass the mixed type and rely on @actions/exec handling.

**Effort:** 5 minutes
**Risk:** Low (works in practice)

## Recommended Action

Option 1 — filter undefined values. Makes intent explicit.

## Technical Details

**Affected files:**
- `src/container/exec.ts:20`

## Acceptance Criteria

- [ ] No `as Record<string, string>` cast for `process.env`
- [ ] Tests pass

## Work Log

### 2026-03-18 - Discovery

**By:** Claude Code review
