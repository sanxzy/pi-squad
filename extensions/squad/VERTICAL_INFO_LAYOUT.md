# Vertical Info Layout ✅

## Overview

The member info bar in the tab session view has been changed from a **horizontal flex layout** to a **vertical column layout**, with status info now displayed below the member name instead of on the same line.

## Visual Result

### Before (Horizontal Layout)
```
┌─────────────────────────────────────────────────────────┐
│ ━━━━● Reviewer━━━━│────✓ Scout─────│───○ Architect───  │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ ● Reviewer (reviewer)          ⠋ 12s [████░░░░░░]      │
│ Reviews code and provides feedback                      │
```

### After (Vertical Layout)
```
┌─────────────────────────────────────────────────────────┐
│ ━━━━● Reviewer━━━━│────✓ Scout─────│───○ Architect───  │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ ● Reviewer (reviewer)                                   │
│ ⠋ 12s [████░░░░░░]                                      │
│ Reviews code and provides feedback                      │
```

## Implementation Changes

### renderTabSession Function

**File:** `overlay-render.ts`

**Before:**
```typescript
// Info bar: status + role + elapsed + output size
const infoLeft = `${icon} ${theme.fg(mc, member.config.name)} ${theme.fg("dim", `(${member.config.role})`)}`;

let infoRight = "";
if (member.startedAt && (member.status === "running" || member.status === "spawning")) {
  const elapsed = formatElapsed(Date.now() - member.startedAt);
  const spinner = theme.fg(mc, getSpinnerFrame());
  const timeoutMs = member.config.timeout;
  const ratio = (Date.now() - member.startedAt) / timeoutMs;
  const bar = makeProgressBar(ratio, 10, theme);
  infoRight = `${spinner} ${theme.fg("dim", elapsed)} ${bar}`;
}

// Calculate gap and render on same line
const infoLeftW = visibleWidth(infoLeft);
const infoRightW = visibleWidth(infoRight);
const infoGap = " ".repeat(Math.max(1, width - infoLeftW - infoRightW));
lines.push(truncateToWidth(infoLeft + infoGap + infoRight, width));
```

**After:**
```typescript
// Info bar: status + role (line 1) and elapsed + output size (line 2)
const infoLeft = `${icon} ${theme.fg(mc, member.config.name)} ${theme.fg("dim", `(${member.config.role})`)}`;
lines.push(truncateToWidth(infoLeft, width)); // Line 1

// Second line: status info (elapsed, progress, done, etc.)
let infoRight = "";
if (member.startedAt && (member.status === "running" || member.status === "spawning")) {
  const elapsed = formatElapsed(Date.now() - member.startedAt);
  const spinner = theme.fg(mc, getSpinnerFrame());
  const timeoutMs = member.config.timeout;
  const ratio = (Date.now() - member.startedAt) / timeoutMs;
  const bar = makeProgressBar(ratio, 10, theme);
  infoRight = `${spinner} ${theme.fg("dim", elapsed)} ${bar}`;
}

lines.push(truncateToWidth(infoRight, width)); // Line 2
```

## Info Content by Status

| Status | Line 1 | Line 2 |
|--------|--------|--------|
| **Running** | `● Reviewer (reviewer)` | `⠋ 12s [████░░░░░░]` |
| **Spawning** | `◐ Reviewer (reviewer)` | `⠋ 2s [██░░░░░░░░]` |
| **Completed** | `✓ Reviewer (reviewer)` | `✓ done · 1.2k chars` |
| **Error** | `✗ Reviewer (reviewer)` | `✗ error` |
| **Timeout** | `⏱ Reviewer (reviewer)` | `✗ timeout` |
| **Aborted** | `⊘ Reviewer (reviewer)` | `⊘ aborted` |
| **Idle** | `○ Reviewer (reviewer)` | `idle` |

## Benefits

| Benefit | Description |
|---------|-------------|
| **Better Readability** | Each piece of info has its own line |
| **More Space** | Progress bar can be full width |
| **Clearer Hierarchy** | Name/role first, status second |
| **Easier to Scan** | Vertical layout matches reading pattern |
| **Consistent** | Matches detail view layout |

## Complete Example

### Running Member
```
┌─────────────────────────────────────────────────────────┐
│ ━━━━● Reviewer━━━━│────✓ Scout─────│───○ Architect───  │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ ● Reviewer (reviewer)                                   │
│ ⠋ 12s [████████░░]                                      │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│
│ 1 │ The authentication module has...                    │
```

### Completed Member
```
┌─────────────────────────────────────────────────────────┐
│ ━━━━● Reviewer━━━━│────✓ Scout─────│───○ Architect───  │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ ✓ Reviewer (reviewer)                                   │
│ ✓ done · 1.2k chars                                     │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│
│ 1 │ Security issues found:                              │
│ 2 │ 1. Weak password hashing                            │
```

### Error Member
```
┌─────────────────────────────────────────────────────────┐
│ ━━━━● Reviewer━━━━│────✓ Scout─────│───○ Architect───  │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ ✗ Reviewer (reviewer)                                   │
│ ✗ error                                                 │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│
│   ⚠ Process exited with code 1                          │
```

## Testing

All tests pass:
```
✔ 12 tests pass
✔ 8 suites pass
✖ 0 tests fail
```

TypeScript: ✅ Pass  
Biome: ✅ Pass

## Summary

The vertical info layout provides:
- ✅ Two-line info bar (name/role on line 1, status on line 2)
- ✅ Full-width progress bars
- ✅ Better readability
- ✅ Clearer visual hierarchy
- ✅ Consistent with detail view

The tab session view now has a cleaner, more readable layout! 🎉
