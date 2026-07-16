---
status: complete
priority: p2
issue_id: "016"
tags: [code-review, architecture, refactor]
dependencies: ["015"]
---

# Replace `curl` Exec Calls with `@actions/http-client`

## Problem Statement

Four HTTP operations in `src/cli/record-flush.ts` and `src/container/lifecycle.ts` are implemented by shelling out to `curl`. This is fragile: it relies on `curl` being available on the runner, uses brittle stdout-scraping to extract the HTTP status code, and makes the functions harder to test (requires mocking `exec.exec` instead of just mocking an HTTP client).

## Findings

- `src/cli/record-flush.ts:18–28` — `verifyRunnerReachable` uses `curl -s --write-out %{http_code}`
- `src/cli/record-flush.ts:58–76` — `recordFlush` uses `curl -X POST --write-out '\n%{http_code}'`
- `src/cli/record-flush.ts:129–147` — `modeSwitch` uses `curl -X PUT --write-out '\n%{http_code}'`
- `src/container/lifecycle.ts:81–90` — `waitForHealth` uses `curl -s --write-out %{http_code}`
- Status code parsed by splitting stdout on newlines at lines 78–79 — fragile if body ends with 3 digits
- `@actions/http-client` already in dependencies (though currently unused)
- `curl` may not be available on all runners (Windows)

## Proposed Solutions

### Option 1: Replace all four with `@actions/http-client`

```typescript
import { HttpClient } from '@actions/http-client'
const client = new HttpClient('wiremock-runner-action')

// verifyRunnerReachable
const res = await client.get(healthUrl)
if (res.message.statusCode < 200 || res.message.statusCode >= 300) { ... }

// recordFlush
const res = await client.postJson(url, body)
```

**Pros:**
- No `curl` dependency
- Status codes as typed numbers, no string parsing
- Functions testable by mocking `HttpClient` instead of `exec.exec`
- Proper error types (network error = rejected promise, not exit code check)
- Works on all runner platforms including Windows

**Cons:**
- Moderate refactor
- Need to update all tests from exec mocking to http-client mocking

**Effort:** 3–4 hours

**Risk:** Medium (HTTP behavior must be verified)

## Recommended Action

Option 1. Prioritize after todo 014 (process.exit) is done as the functions will be cleaner once they can throw.

## Technical Details

**Affected files:**
- `src/cli/record-flush.ts` — 3 functions
- `src/container/lifecycle.ts` — `waitForHealth`
- `src/__tests__/cli/record-flush.test.ts` — tests need updating to mock `@actions/http-client`

## Acceptance Criteria

- [x] No `curl` exec calls remain in `record-flush.ts` or `lifecycle.ts`
- [x] Status code handling uses typed numbers, not string parsing
- [x] All tests updated and passing
- [x] `curl` not required on runner for these operations

## Work Log

### 2026-03-18 - Discovery

**By:** Architecture review agent

### 2026-07-16 - Verified complete

**By:** Claude Code review

**Actions:**
- Confirmed zero `curl` references remain anywhere under `src/`
- `record-flush.ts` and `lifecycle.ts` both use `@actions/http-client` with typed `statusCode` checks
- Landed in commit `a9c88e6` alongside todos 002, 007, 018; frontmatter was never updated at the time
