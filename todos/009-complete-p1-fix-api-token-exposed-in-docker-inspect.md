---
status: complete
priority: p1
issue_id: "009"
tags: [code-review, security, p1]
dependencies: []
---

# Fix API Token Exposed via `docker inspect` and Process List

## Problem Statement

`src/container/lifecycle.ts:47` passes the WireMock API token as a literal `-e WMC_API_TOKEN=<value>` flag to `docker run`. Docker stores environment variables in the container's configuration and they are readable via `docker inspect <container>` by any process on the runner host. This bypasses `core.setSecret`'s log masking — masking prevents logging, not OS-level inspection.

## Findings

- `src/container/lifecycle.ts:47` — `args.push('-e', \`WMC_API_TOKEN=${inputs['api-token']}\`)`
- `docker inspect <container>` exposes all `-e` values to any process that can reach the Docker socket
- On self-hosted runners with concurrent jobs, another job could read the token
- `core.setSecret` only masks log output, not `docker inspect` output

## Proposed Solutions

### Option 1: Write token to a tmpfs-mounted secret file

**Approach:** Write the token to a temporary file with `0600` permissions, mount it as a Docker volume (`-v /tmp/wmc-secret:/run/secrets/token:ro`), and configure the Runner to read from that path instead of an env var.

**Pros:**
- Token not visible in `docker inspect` env section
- File deleted after container stops

**Cons:**
- Requires Runner image to support reading from a file path (may not be supported)
- More complex implementation

**Effort:** 2–4 hours

**Risk:** Medium (requires Runner image support)

---

### Option 2: Pass token via stdin or socket (if Runner supports it)

**Approach:** Check if the WireMock Runner image accepts the token via stdin at startup or via a different mechanism.

**Pros:**
- Cleanest approach

**Cons:**
- Depends on Runner image capability

**Effort:** Research + 2 hours

**Risk:** Medium

---

### Option 3: Document the risk and add a warning

**Approach:** If the Runner image only supports env var injection, add a prominent security warning in the README about self-hosted runner risks. Still pass via `-e` but document it.

**Pros:**
- No code change needed now

**Cons:**
- Risk remains for self-hosted runner users

**Effort:** 30 minutes

**Risk:** Low (documentation only)

## Recommended Action

Investigate whether the Runner image supports file-based token injection. If not, implement Option 3 as an interim while researching Runner image changes with the WireMock team.

## Technical Details

**Affected files:**
- `src/container/lifecycle.ts:47`
- `README.md` (security warning)

## Acceptance Criteria

- [ ] API token not visible in `docker inspect` output on self-hosted runners
- OR
- [ ] README contains explicit security warning about self-hosted runner risks

## Work Log

### 2026-03-18 - Discovery

**By:** Security review agent
