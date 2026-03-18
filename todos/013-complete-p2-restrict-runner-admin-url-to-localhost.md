---
status: complete
priority: p2
issue_id: "013"
tags: [code-review, security, ssrf]
dependencies: []
---

# Restrict `runner-admin-url` to Localhost (SSRF Prevention)

## Problem Statement

`runner-admin-url` is validated as a URL syntax-only (`z.string().url()`) but the host is unrestricted. Any URL including cloud metadata endpoints (`http://169.254.169.254/`) can be supplied. The action then executes `curl` against that URL, making the runner act as an SSRF proxy. On self-hosted cloud runners, this is a direct credential theft vector via IMDS.

## Findings

- `src/inputs.ts:36` — `'runner-admin-url': z.string().url().default('http://localhost:9999')`
- `src/cli/record-flush.ts:47` — curl executes against the supplied admin URL
- `src/container/lifecycle.ts:81` — health check curl against admin URL
- `http://169.254.169.254/latest/meta-data/iam/security-credentials/` returns cloud credentials on AWS
- GitHub-hosted runners restrict IMDS; self-hosted cloud runners may not

## Proposed Solutions

### Option 1: Restrict to localhost/127.0.0.1 with Zod refine

```typescript
'runner-admin-url': z.string().url()
  .refine(url => {
    const { hostname } = new URL(url)
    return hostname === 'localhost' || hostname === '127.0.0.1'
  }, 'runner-admin-url must target localhost (e.g. http://localhost:9999)')
  .default('http://localhost:9999'),
```

**Pros:**
- Eliminates SSRF risk entirely for the primary use case
- Simple to implement

**Cons:**
- Would break setups where the Runner is running on a non-localhost hostname (e.g., Docker Compose sidecar pattern)
- The sidecar services pattern uses a service hostname like `http://wiremock-runner:9999`

**Effort:** 30 minutes

**Risk:** Low (for localhost use case)

---

### Option 2: Restrict to RFC 1918 + localhost

**Approach:** Allow any RFC 1918 private IP range (10.x, 172.16-31.x, 192.168.x) and localhost. This accommodates Docker Compose sidecar patterns.

**Pros:**
- Covers the sidecar services pattern
- Still blocks cloud IMDS (169.254.x.x is link-local, not RFC 1918)

**Cons:**
- More complex regex/logic

**Effort:** 1 hour

**Risk:** Low

---

### Option 3: Add documentation warning only

**Approach:** Document the SSRF risk explicitly in the README with a note about self-hosted runner risks.

**Effort:** 30 minutes

**Risk:** None (no behavior change)

## Recommended Action

Option 2 for production hardening. Start with Option 3 immediately as documentation is needed regardless.

## Technical Details

**Affected files:**
- `src/inputs.ts:36`
- `README.md`
- `src/__tests__/inputs.test.ts`

## Acceptance Criteria

- [ ] `runner-admin-url: 'http://169.254.169.254/'` fails validation (or warning in README)
- [ ] `runner-admin-url: 'http://localhost:9999'` passes
- [ ] `runner-admin-url: 'http://wiremock-runner:9999'` behavior documented

## Work Log

### 2026-03-18 - Discovery

**By:** Security review agent
