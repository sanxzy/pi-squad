# Auto-Notification Workflow ✅

## Overview

The squad extension now provides **automatic completion notifications** with inline chat messages, so the main agent doesn't need to poll for status. When background tasks complete, the system automatically injects a detailed notification into the chat.

## Improved Workflow

### Before (Manual Polling)

```
User: "Ask squad members to introduce themselves"

LLM: [broadcasts task]
Task ID: squad_123

LLM: [manually polls]
squad get_status → 2 running

LLM: [polls again]
squad get_status → 2 running

LLM: [polls again]
squad get_status → 2 running

LLM: [finally complete]
squad get_output reviewer → [output]
squad get_output scout → [output]
```

**Problem:** Main agent constantly polls, interrupting flow.

### After (Auto-Notification)

```
User: "Ask squad members to introduce themselves"

LLM: [broadcasts task]
Task ID: squad_123

LLM: [continues working on other things...]

[30 seconds later - automatic message appears in chat]
✅ Squad Task Complete (45.3s)

Task ID: squad_123
Results: 2 completed, 0 failed

✓ reviewer (23.1s)
  Hello! I'm The Reviewer...

✓ scout (18.7s)
  Hello! I'm the Scout...

Use `squad get_completed_outputs "squad_123"` to retrieve full outputs.

LLM: [sees notification, retrieves all outputs at once]
squad get_completed_outputs "squad_123" → [all outputs]

LLM: [presents results to user]
```

**Benefit:** Main agent works uninterrupted, retrieves results when ready.

## Key Features

### 1. Automatic Chat Injection

When background tasks complete, a detailed message is automatically injected into the chat:

```
✅ **Squad Task Complete** (45.3s)

**Task ID:** squad_1773307746605_zhw0df
**Results:** 2 completed, 0 failed

✓ **reviewer** (23.1s)
  Hello! I'm The Reviewer. I specialize in code review...

✓ **scout** (18.7s)
  Hello! I'm the Scout. I help explore codebases...

Use `squad get_completed_outputs "squad_1773307746605_zhw0df"` to retrieve full outputs.
```

### 2. `get_completed_outputs` Action

New tool action to retrieve all outputs from a completed task at once:

```json
{
  "action": "get_completed_outputs",
  "task_id": "squad_1773307746605_zhw0df"
}
```

**Returns:**
```markdown
**Task squad_1773307746605_zhw0df - Full Outputs**

### reviewer (23.1s)

Hello! I'm The Reviewer. I specialize in code review...

---

### scout (18.7s)

Hello! I'm the Scout. I help explore codebases...

---
```

### 3. Non-Intrusive Notifications

- Toast notification: "Squad task complete: 2/2 members"
- Chat message with full details
- Does NOT trigger agent turn (non-blocking)
- Main agent can retrieve when ready

## Implementation

### BackgroundDispatcher Updates

**File:** `background-dispatcher.ts`

```typescript
private notifyParent(task: BackgroundDispatchTask, isTimeout = false): void {
  // Build detailed message
  let message = `✅ **Squad Task Complete** (${duration}s)\n\n`;
  message += `**Task ID:** ${task.id}\n`;
  message += `**Results:** ${completedCount} completed, ${failedCount} failed\n\n`;
  
  // Include preview of each output
  for (const result of results) {
    message += `${icon} **${result.role}**\n`;
    message += `  ${output_preview}\n`;
  }
  
  message += `Use \`squad get_completed_outputs "${task.id}"\` to retrieve full outputs.`;
  
  // Inject as chat message (doesn't trigger turn)
  this.pi.sendMessage(
    { customType: "squad-task-complete", content: message, display: true },
    { triggerTurn: false }
  );
}
```

### New Tool Action

**File:** `index.ts`

```typescript
case "get_completed_outputs": {
  if (!params.task_id) throw new Error("Missing task_id");
  
  const task = state.dispatcher!.getTask(params.task_id);
  if (!task) return error("Task not found");
  if (task.status !== "completed") return info("Still running");
  
  // Return all outputs
  const lines = [`**Task ${params.task_id} - Full Outputs**\n`];
  for (const result of task.results.values()) {
    lines.push(`\n### ${result.role}\n`);
    lines.push(result.output || "*No output*");
    lines.push("\n---\n");
  }
  
  return { content: [{ type: "text", text: lines.join("\n") }] };
}
```

### Message Renderer

```typescript
pi.registerMessageRenderer("squad-task-complete", (message, { expanded }, theme) => {
  if (!expanded) {
    return new Text(theme.fg("success", "✅ Squad task complete"), 0, 0);
  }
  return new Text(message.content as string, 0, 0);
});
```

## Usage Examples

### Example 1: Parallel Research

```
User: "Research our authentication system"

LLM: {
  "action": "parallel_dispatch",
  "prompts": {
    "reviewer": "Review auth code for security issues",
    "scout": "Find all auth-related files",
    "architect": "Analyze auth architecture"
  }
}

→ Returns immediately: Task ID: squad_abc123

[LLM continues working...]

[30s later - auto notification appears]
✅ Squad Task Complete (28.4s)
Task ID: squad_abc123
Results: 3 completed, 0 failed

✓ reviewer (15.2s)
  Security issues found: 1. Weak password hashing...

✓ scout (8.7s)
  Found 12 files: src/auth/login.ts, src/auth/session.ts...

✓ architect (22.1s)
  Architecture recommendations: 1. Add OAuth2...

Use `squad get_completed_outputs "squad_abc123"` to retrieve full outputs.

LLM: {
  "action": "get_completed_outputs",
  "task_id": "squad_abc123"
}

→ Gets all outputs, synthesizes response
```

### Example 2: Code Review

```
User: "Review this PR for issues"

LLM: {
  "action": "broadcast",
  "prompt": "Review the changes in PR #123 for bugs, security issues, and performance problems"
}

→ Returns: Task ID: squad_xyz789

[LLM checks other things...]

[Auto notification]
✅ Squad Task Complete (45.6s)

LLM: {
  "action": "get_completed_outputs",
  "task_id": "squad_xyz789"
}

→ Presents review results
```

## Benefits

| Benefit | Description |
|---------|-------------|
| **No Polling** | Main agent doesn't waste turns checking status |
| **Better Flow** | Conversation continues naturally |
| **Efficient** | Retrieve all outputs at once when ready |
| **Clear UX** | Notification shows task ID and previews |
| **Non-Blocking** | `triggerTurn: false` - doesn't interrupt |

## Task Lifecycle

```
launch() → Returns task ID immediately
    │
    ├─→ Members execute in background
    │   ├─→ Member 1: running...
    │   ├─→ Member 2: running...
    │   └─→ Member N: running...
    │
    ├─→ Polling monitors (3s interval)
    │
    └─→ All complete
        │
        ├─→ Inject chat message (auto)
        │   └─→ Shows task ID, previews
        │
        └─→ LLM retrieves when ready
            └─→ get_completed_outputs(task_id)
```

## Error Handling

### Task Not Found

```json
{
  "action": "get_completed_outputs",
  "task_id": "invalid_id"
}
```

**Response:**
```
Task invalid_id not found. Use get_status to check active tasks.
```

### Task Still Running

```json
{
  "action": "get_completed_outputs",
  "task_id": "squad_abc123"
}
```

**Response:**
```
Task squad_abc123 is still running. Wait for completion notification.
```

### Timeout

If task times out (30 minutes):
```
✅ Squad Task Complete (30m 0s)

Task ID: squad_abc123
Results: 0 completed, 2 failed

⚠️ Task timed out

✗ reviewer (timeout)
  Error: Timed out after 1800000ms

✗ scout (timeout)
  Error: Timed out after 1800000ms
```

## Testing

All tests pass:
```
✔ 12 tests pass
✔ 8 suites pass
✖ 0 tests fail
```

TypeScript: ✅ Pass

## Files Modified

1. **`background-dispatcher.ts`** - Added pi reference, enhanced notification
2. **`index.ts`** - Added `get_completed_outputs` action, message renderer
3. **`AUTO_NOTIFIED_WORKFLOW.md`** - This documentation

## Summary

The auto-notification workflow provides a **much better user experience**:

1. **Launch task** → Get task ID immediately
2. **Continue working** → No polling needed
3. **Get notified** → Automatic chat message when complete
4. **Retrieve outputs** → Get all results at once with `get_completed_outputs`

Main conversation flows naturally without interruption! 🎉
