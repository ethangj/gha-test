---
status: complete
priority: p3
issue_id: "008"
tags: [code-review, type-safety]
dependencies: []
---

# Fix `summary.ts` Table Row Type Mismatch

## Problem Statement

`src/summary.ts:22` passes plain string arrays as table rows to `core.summary.addTable()`, but the `@actions/core` type expects `SummaryTableRow` (an array of `SummaryTableCell | string`). While it works at runtime, TypeScript's structural type checking may flag this in strict mode.

## Findings

- `src/summary.ts:22-23` — header row uses `{ data: '...', header: true }` objects (correct)
- `src/summary.ts:23` — data row uses `[operation, status]` plain strings
- `addTable` signature expects `SummaryTableRow[]` where each row is `Array<SummaryTableCell | string>`
- Plain strings are valid per the type union, but mixing with header objects can cause IDE type errors
- Same pattern at lines 29-32 for the URLs table

## Proposed Solutions

### Option 1: Verify current types compile cleanly

Run `npx tsc --noEmit` and check for errors. If no errors, this may be a non-issue.

**Effort:** 5 minutes
**Risk:** None

---

### Option 2: Annotate row arrays explicitly

```typescript
[operation, status] as SummaryTableRow,
```

**Effort:** 10 minutes
**Risk:** Low

## Recommended Action

Run `tsc --noEmit` first. If clean, close this todo. If errors, add explicit type annotations.

## Technical Details

**Affected files:**
- `src/summary.ts:22-32`

## Acceptance Criteria

- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] No type assertions needed if already clean

## Work Log

### 2026-03-18 - Discovery + Verification

**By:** Claude Code review

**Actions:**
- Ran `npx tsc --noEmit` — clean, zero errors
- The plain string arrays are valid per `SummaryTableRow = Array<SummaryTableCell | string>`
- **CLOSED: Not an actual issue**
