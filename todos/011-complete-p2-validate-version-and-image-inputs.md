---
status: complete
priority: p2
issue_id: "011"
tags: [code-review, security, input-validation]
dependencies: []
---

# Add Regex Validation for `wiremock-cli-version` and `runner-version` Inputs

## Problem Statement

Both `wiremock-cli-version` and `runner-version` are accepted as free-form strings with only `z.string().default(...)` validation. This allows:
- `wiremock-cli-version`: An npm package specifier with `file:`, `git+https:`, `http:` prefixes or shell metacharacters that could install arbitrary packages
- `runner-version`: A Docker image reference with a registry prefix (e.g., `attacker.io/malicious:latest`) or other crafted values that could pull from arbitrary registries

## Findings

- `src/inputs.ts:13` — `'runner-version': z.string().default('latest')` — no format constraint
- `src/inputs.ts:44` — `'wiremock-cli-version': z.string().default('latest')` — no format constraint
- `src/cli/installer.ts:19` — `\`@wiremock/cli@${version}\`` — version injected directly into npm pkg specifier
- `src/container/lifecycle.ts:25` — `` `wiremock/wiremock-runner:${inputs['runner-version']}` `` — injected into Docker image ref
- npm accepts `file:`, `git+`, `http:` prefixes in package specifiers
- Docker image refs accept registry prefixes with `/` slashes

## Proposed Solutions

### Option 1: Add Zod `.refine()` with strict semver/tag pattern

```typescript
const VERSION_PATTERN = /^(latest|[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9._-]+)?)$/

'runner-version': z.string().default('latest')
  .refine(v => VERSION_PATTERN.test(v), 'must be "latest" or a semver version like 1.2.3'),
'wiremock-cli-version': z.string().default('latest')
  .refine(v => VERSION_PATTERN.test(v), 'must be "latest" or a semver version like 1.2.3'),
```

**Pros:**
- Validates at input layer before any exec call
- Consistent with existing Zod validation pattern
- Blocks registry override and injection

**Cons:**
- Must allow legitimate pre-release tags (e.g., `1.2.3-beta.1`)

**Effort:** 30 minutes

**Risk:** Low

## Recommended Action

Option 1 — add Zod refinements to `inputs.ts` for both fields. Also add test cases in `inputs.test.ts` for invalid version formats.

## Technical Details

**Affected files:**
- `src/inputs.ts:13,44`
- `src/__tests__/inputs.test.ts` (new test cases)

## Acceptance Criteria

- [ ] `runner-version: 'attacker.io/malicious:latest'` fails validation
- [ ] `wiremock-cli-version: 'file:../malicious'` fails validation
- [ ] `runner-version: 'latest'` passes validation
- [ ] `runner-version: '1.2.3'` passes validation
- [ ] Tests added for invalid format rejection

## Work Log

### 2026-03-18 - Discovery

**By:** Security review agent
