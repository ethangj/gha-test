---
status: complete
priority: p2
issue_id: "003"
tags: [code-review, type-safety, quality]
dependencies: []
---

# Fix Unsafe `yaml.load` Type Casts

## Problem Statement

`yaml.load()` returns `unknown` but is cast directly to typed interfaces with `as WireMockConfig` and `as Partial<WireMockConfig>`. If YAML is malformed or has unexpected structure, runtime errors will occur deep in the call stack with confusing messages instead of clear validation errors at the point of load.

## Findings

- `src/utils/yaml-reader.ts:29` — `yaml.load(...) as WireMockConfig` with only a `?.services` null check
- `src/utils/yaml-reader.ts:49` — `yaml.load(...) as Partial<WireMockConfig>` with no validation
- `src/cli/record-flush.ts:111` — similar pattern with runner config YAML
- If a user puts `services: null` or a non-object value, `Object.entries(profileConfig.services)` will throw a cryptic JS error

## Proposed Solutions

### Option 1: Add runtime validation with Zod

**Approach:** Define `WireMockConfigSchema` with Zod and parse the YAML output through it.

```typescript
const WireMockConfigSchema = z.object({
  services: z.record(z.object({
    type: z.string().optional(),
    port: z.number(),
    // ...
  }))
})
const baseConfig = WireMockConfigSchema.parse(yaml.load(...))
```

**Pros:**
- Clear, typed validation errors
- Consistent with existing Zod usage in `inputs.ts`

**Cons:**
- Adds schema definition to maintain

**Effort:** 1–2 hours

**Risk:** Low

---

### Option 2: Manual type guards

**Approach:** Write a `isWireMockConfig(obj: unknown): obj is WireMockConfig` type guard and throw with a clear message on failure.

**Pros:**
- No new dependency
- Explicit error messages

**Cons:**
- More verbose than Zod

**Effort:** 1 hour

**Risk:** Low

## Recommended Action

Option 1 (Zod) is preferred for consistency with `inputs.ts`. Define schemas inline in `yaml-reader.ts`.

## Technical Details

**Affected files:**
- `src/utils/yaml-reader.ts:29,49`
- `src/cli/record-flush.ts:111` (check what YAML it parses)

## Acceptance Criteria

- [ ] `yaml.load` results validated before cast
- [ ] Invalid YAML produces clear error message (not cryptic JS TypeError)
- [ ] Existing tests pass
- [ ] Tests added for malformed YAML inputs

## Work Log

### 2026-03-18 - Discovery

**By:** Claude Code review
