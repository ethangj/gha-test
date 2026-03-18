---
status: complete
priority: p1
issue_id: "015"
tags: [code-review, architecture, dead-code]
dependencies: []
---

# Remove Unused Production Dependencies (`@actions/http-client`, `@actions/io`)

## Problem Statement

`@actions/http-client` and `@actions/io` are declared in `package.json` `dependencies` (not `devDependencies`) but are never imported anywhere in `src/`. They increase the `dist/index.js` bundle size unnecessarily and add attack surface. This is especially notable because `@actions/http-client` is the first-party replacement for the `curl` exec pattern used in `record-flush.ts`.

## Findings

- `package.json:17,19` — both packages in `dependencies`
- `grep -r "http-client\|@actions/io" src/` — zero results
- `src/cli/record-flush.ts` makes HTTP calls via `curl` exec despite `@actions/http-client` being available
- Including unused packages in `dependencies` means they're bundled into `dist/index.js`

## Proposed Solutions

### Option 1: Remove both from `package.json` dependencies

```bash
npm uninstall @actions/http-client @actions/io
```

**Pros:**
- Smaller bundle
- Cleaner dependency surface

**Cons:**
- If the curl→http-client migration (todo 016) is done, `@actions/http-client` would need to be re-added
- May want to defer this until after todo 016 is decided

**Effort:** 5 minutes

**Risk:** Low

---

### Option 2: Keep `@actions/http-client`, remove only `@actions/io`

**Approach:** If todo 016 (migrate curl to http-client) is planned, keep `@actions/http-client`. Remove `@actions/io` which has no planned use.

**Pros:**
- Less churn if migration is imminent

**Cons:**
- Still an unused dep until migration

**Effort:** 5 minutes

**Risk:** Low

## Recommended Action

If implementing todo 016 (curl → http-client migration): Option 2.
If not planning to migrate: Option 1.

## Technical Details

**Affected files:**
- `package.json`
- `package-lock.json` (auto-updated by npm)
- `dist/index.js` (rebuild needed)

## Acceptance Criteria

- [ ] `@actions/io` removed from package.json
- [ ] `@actions/http-client` removed (or moved to devDependencies as placeholder for future use)
- [ ] `npm run build` passes
- [ ] `npm test` passes

## Work Log

### 2026-03-18 - Discovery

**By:** Architecture review agent
