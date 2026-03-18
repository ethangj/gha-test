---
status: complete
priority: p2
issue_id: "019"
tags: [code-review, simplicity, refactor]
dependencies: []
---

# Simplify 409 Mode-Switch Check and Extract `curlRequest` Helper

## Problem Statement

Two simplification opportunities in `src/cli/record-flush.ts`:

1. The 409 "already in mode" check at lines 153–168 uses JSON.parse + optional chaining to detect a specific string — but then treats a parse failure identically to a non-match. The JSON structure adds no safety and could be replaced with a direct `includes()` call.

2. The curl-with-response-body pattern (build args, exec curl, split stdout on last newline to extract HTTP code) is duplicated in full in `recordFlush` (lines 55–79) and `modeSwitch` (lines 126–150). This is ~20 lines duplicated verbatim.

## Findings

- `src/cli/record-flush.ts:153–168` — JSON.parse + optional chain + try/catch, all to check if `detail` includes `'Runner is already in'`
- `src/cli/record-flush.ts:55–79` and `126–150` — identical curl exec + stdout capture + split pattern
- `src/cli/record-flush.ts:154` and `172` — `parts.slice(0, -1).join('\n')` repeated twice within `modeSwitch`

## Proposed Solutions

### Option 1: Flatten 409 check + extract `curlRequest` helper

**Approach:**

```typescript
// Flatten 409 check:
const isAlreadyInMode = responseText.includes('Runner is already in')

// Extract helper:
async function curlRequest(args: string[]): Promise<{ exitCode: number; httpCode: string; body: string }> {
  let output = ''
  const exitCode = await exec.exec('curl', args, {
    silent: true, ignoreReturnCode: true,
    listeners: { stdout: (d: Buffer) => { output += d.toString() } }
  })
  const parts = output.trim().split('\n')
  return { exitCode, httpCode: parts[parts.length - 1], body: parts.slice(0, -1).join('\n') }
}
```

**Pros:**
- Removes try/catch that adds no safety
- Eliminates ~20 LOC of duplication
- Makes `modeSwitch` and `recordFlush` easier to read (just arg construction + response handling)

**Cons:**
- Small refactor touching tested code

**Effort:** 1 hour

**Risk:** Low (behavior-preserving)

## Recommended Action

Option 1. Note: if todo 016 (migrate to http-client) is implemented, this todo becomes moot.

## Technical Details

**Affected files:**
- `src/cli/record-flush.ts:55–79, 126–150, 153–168`

## Acceptance Criteria

- [ ] `isAlreadyInMode` check uses `includes()`, no try/catch around JSON.parse
- [ ] `curlRequest` helper extracted (or this deferred if http-client migration planned)
- [ ] All existing record-flush tests pass
- [ ] No behavior change

## Work Log

### 2026-03-18 - Discovery

**By:** Simplicity + Pattern review agents
