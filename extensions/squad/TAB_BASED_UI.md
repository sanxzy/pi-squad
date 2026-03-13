# Tab-Based Squad Overlay UI ✅

## Overview

The squad overlay has been refactored from a card-based list to a **tab-based interface** with horizontal navigation and per-member color coding.

## Key Changes

### 1. Tab Bar Navigation

**Before:** Vertical card list with ↑↓ navigation  
**After:** Horizontal tab bar with ←→ navigation

```
┌─────────────────────────────────────────────────────────┐
│ ◆ Squad ◆                                               │
│ ⠋ 3/5  ✓2  ✗1  ○2                                       │
├─────────────────────────────────────────────────────────┤
│ ▕ ● Reviewer ▏│ ✓ Scout │ ○ Architect │ ○ Tester │ ○   │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ ● Reviewer (reviewer)                                   │
│ Reviews code and provides feedback                      │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│
│ 1 │ The authentication module has...                    │
│ 2 │ ...                                                 │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ ←→:Tabs  Enter:Detail  o:Output  s:Grid  p:Prompt      │
╰─────────────────────────────────────────────────────────╯
```

### 2. Per-Member Color Coding

Each squad member gets a unique color from a rotating palette:

| Member Index | Color |
|--------------|-------|
| 0 | accent (blue) |
| 1 | success (green) |
| 2 | warning (yellow) |
| 3 | error (red) |
| 4 | muted (gray) |
| 5+ | cycles back to accent |

**Visual Example:**
```
▕ ● Reviewer ▏│ ✓ Scout │ ○ Architect │ ○ Tester
  accent      │ success   │ warning     │ error
```

### 3. Navigation Changes

| Action | Before | After |
|--------|--------|-------|
| Navigate members | ↑↓ | ←→ |
| Scroll content | ←→ | ↑↓ |
| Next tab | Tab | (removed) |
| Grid view | (not present) | `s` key |

### 4. Legend Updates

**List View (Tab Navigation):**
```
←→:Tabs  Enter:Detail  o:Output  s:Grid  p:Prompt  P:All  a:Abort  r:Redo  Esc:Close
```

**Detail/Output View (Scrolling):**
```
Esc:Back  ↑↓:Scroll  o:FullOutput  a:Abort  r:Redo  p:Prompt  ^T:Snapshot
```

## Implementation Details

### overlay.ts Changes

**Navigation Logic:**
```typescript
// Left/right for tab navigation in list mode
if (this.viewState.mode === "list") {
  if (matchesKey(data, "left")) {
    this.viewState.selectedIndex = Math.max(0, this.viewState.selectedIndex - 1);
    this.tui.requestRender();
    return;
  }
  if (matchesKey(data, "right")) {
    this.viewState.selectedIndex = Math.min(members.length - 1, this.viewState.selectedIndex + 1);
    this.tui.requestRender();
    return;
  }
}

// Up/down for scrolling in detail/output modes
if (this.viewState.mode === "detail" || this.viewState.mode === "output") {
  if (matchesKey(data, "up")) {
    this.viewState.detailScroll = Math.max(0, this.viewState.detailScroll - 1);
    this.tui.requestRender();
    return;
  }
  if (matchesKey(data, "down")) {
    this.viewState.detailScroll++;
    this.tui.requestRender();
    return;
  }
}
```

### overlay-render.ts Changes

**Tab Bar Rendering:**
```typescript
function renderTabBar(
  theme: Theme,
  members: SquadMemberInstance[],
  selectedIndex: number,
  width: number,
): string {
  const tabs: string[] = [];

  for (let i = 0; i < members.length; i++) {
    const member = members[i]!;
    const mc = memberColor(i); // Per-member color
    const icon = STATUS_ICONS[member.status] || "?";
    const isSelected = i === selectedIndex;

    if (isSelected) {
      // Active tab: bold with colored brackets
      const label = theme.fg(mc, `▕ ${icon} ${member.config.name} ▏`);
      tabs.push(label);
    } else {
      // Inactive tab: dimmed
      tabs.push(theme.fg("dim", ` ${icon} ${member.config.name} `));
    }
  }

  return truncateToWidth(tabs.join(theme.fg("dim", "│")), width);
}
```

**Session Content with Member Color:**
```typescript
function renderTabSession(
  theme: Theme,
  member: SquadMemberInstance,
  mc: "accent" | "success" | "warning" | "error" | "muted", // Member color
  width: number,
  height: number,
  viewState: SquadViewState,
): string[] {
  const lines: string[] = [];

  // Info bar with member color
  let infoLeft = `${icon} ${theme.fg(mc, member.config.name)} ${theme.fg("dim", `(${member.config.role})`)}`;
  
  // ... rest of rendering uses mc for consistent color
}
```

## User Experience Improvements

### Benefits

| Benefit | Description |
|---------|-------------|
| **Faster Navigation** | ←→ is more natural for tab switching than ↑↓ |
| **Better Identity** | Per-member colors make it easy to track specific members |
| **Clearer Mental Model** | Tabs match browser/terminal conventions |
| **More Content Space** | Tab bar uses less vertical space than card list |
| **Consistent Scrolling** | ↑↓ for content scrolling matches standard behavior |

### Workflow Example

```
User opens overlay (ctrl+shift+s)
    │
    ├─→ See tab bar with all members
    │   ▕ ● Reviewer ▏│ ✓ Scout │ ○ Architect
    │
    ├─→ Press → to switch to Scout tab
    │   ▕ ● Reviewer ▏│ ✓ Scout │ ○ Architect
    │                          ▲ active
    │
    ├─→ Press Enter to see Scout's detail view
    │   ╔════════════════════════════════════╗
    │   ║ ✓ SCOUT · RUNNING                  ║
    │   ╚════════════════════════════════════╝
    │
    ├─→ Press ↑↓ to scroll through details
    │
    └─→ Press Esc to return to tab bar
```

## Files Modified

1. **`overlay.ts`** - Changed navigation from up/down to left/right
2. **`overlay-render.ts`** - Updated legend to show ←→ instead of ↑↓

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

The tab-based UI provides:
- ✅ Horizontal ←→ navigation for tabs
- ✅ Vertical ↑↓ navigation for content scrolling
- ✅ Per-member color coding for easy identification
- ✅ Updated legend with clear keybindings
- ✅ More intuitive mental model

The overlay now feels like a modern tabbed interface! 🎉
