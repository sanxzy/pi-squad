# Non-Blocking Squad Dispatch ✅

## Overview

The squad extension now supports **true non-blocking background dispatch** using a fire-and-forget pattern inspired by oh-my-openagent's parallel-background-agents system.

## Key Feature

**`broadcast` and `parallel_dispatch` actions are now NON-BLOCKING** - they return immediately with a task ID instead of waiting for all squad members to complete.

## How It Works

### Fire-and-Forget Pattern

```
User calls squad tool
    │
    ├─→ Create background task record
    │
    ├─→ Dispatch to all members (don't await!)
    │   ├─→ Member 1: dispatchOne() → runs in background
    │   ├─→ Member 2: dispatchOne() → runs in background
    │   └─→ Member N: dispatchOne() → runs in background
    │
    ├─→ Return immediately with task ID
    │
    └─→ Background polling monitors completion
        │
        └─→ Notify parent when all complete
```

### BackgroundDispatcher Component

New file: `background-dispatcher.ts`

**Features:**
- Task tracking with unique IDs
- Fire-and-forget dispatch methods
- Background polling (3-second interval)
- Parent session notification on completion
- Task timeout handling (30 minutes)
- Automatic cleanup

**Methods:**
- `dispatchAllBackground(prompt, parentSessionID, parentMessageID)` - NON-BLOCKING
- `dispatchCustomBackground(prompts, parentSessionID, parentMessageID)` - NON-BLOCKING
- `getTask(taskId)` - Get task by ID
- `getActiveTasks()` - Get all active tasks
- `startPolling()` / `stopPolling()` - Control polling
- `cleanup()` - Remove old completed tasks

## Usage

### Before (BLOCKING)

```json
{
  "action": "broadcast",
  "prompt": "Analyze the codebase"
}
```

**Result:** Main agent waits (blocked) until all members complete.

### After (NON-BLOCKING)

```json
{
  "action": "broadcast",
  "prompt": "Analyze the codebase"
}
```

**Result:** Returns immediately:
```
Squad broadcast launched in background.

Task ID: squad_1710234567890_abc123
Broadcasting to 2 members: reviewer, scout

You will be notified when complete. Continue with other work.
```

Main agent can continue working while squad members execute in parallel.

## Actions Comparison

| Action | Blocking? | Use Case |
|--------|-----------|----------|
| `broadcast` | ❌ NO | Send same prompt to all members |
| `parallel_dispatch` | ❌ NO | Send different prompts to different members |
| `dispatch_to` | ✅ YES | Send to specific member (need result now) |
| `get_status` | ✅ YES | Check current status |
| `get_output` | ✅ YES | Get output from specific member |
| `cancel` | ✅ YES | Cancel running tasks |
| `list_members` | ✅ YES | List available members |

## Notification System

When background tasks complete, the system notifies the parent session:

```
**Squad Task Complete** (45.3s)

**Results:** 2 completed, 0 failed

✓ reviewer (23.1s)
  The authentication module has several security issues...

✓ scout (18.7s)
  Found 12 files related to authentication...
```

## Task Lifecycle

```
pending → running → completed/error
   │         │           │
   │         │           └─→ Parent notified
   │         │
   │         └─→ Polled every 3s
   │
   └─→ Task ID returned immediately
```

## Example Workflow

### Parallel Research (Non-Blocking)

```
User: "Research our authentication system"

LLM: I'll dispatch parallel tasks to the squad.

[LLM calls squad tool]
{
  "action": "parallel_dispatch",
  "prompts": {
    "reviewer": "Review authentication code for security issues",
    "scout": "Find all authentication-related files",
    "architect": "Analyze auth architecture for improvements"
  }
}

[Returns immediately]
Task ID: squad_1710234567890_xyz789

[LLM continues working...]
LLM: While the squad is researching, let me check the recent commits...

[30 seconds later - notification arrives]
✓ Squad task complete: 3/3 members completed

[LLM reads results and synthesizes]
LLM: Based on the squad's research, here's what I found...
```

## Implementation Details

### Task Tracking

```typescript
interface BackgroundDispatchTask {
  id: string;
  parentSessionID: string;
  parentMessageID: string;
  prompts: Record<string, string>;
  results: Map<string, SquadDispatchResult>;
  status: "pending" | "running" | "completed" | "error";
  startedAt: number;
  completedAt?: number;
}
```

### Polling Mechanism

```typescript
// Poll every 3 seconds
private readonly POLL_INTERVAL = 3000;

startPolling(): void {
  if (this.pollTimer) return;
  this.pollTimer = setInterval(() => {
    this.pollTasks();
  }, this.POLL_INTERVAL);
}

pollTasks(): void {
  for (const task of this.tasks.values()) {
    // Check timeout
    if (now - task.startedAt > TASK_TIMEOUT) {
      task.status = "error";
      this.notifyParent(task, true);
      continue;
    }
    
    // Check completion
    if (task.results.size >= expectedCount) {
      task.status = "completed";
      this.notifyParent(task);
    }
  }
  
  // Stop polling if no active tasks
  if (!hasActiveTasks) this.stopPolling();
}
```

### Parent Notification

```typescript
notifyParent(task: BackgroundDispatchTask, isTimeout = false): void {
  const results = Array.from(task.results.values());
  const completedCount = results.filter((r) => r.status === "completed").length;
  const failedCount = results.filter((r) => r.status !== "completed").length;
  const duration = ((task.completedAt! - task.startedAt) / 1000).toFixed(1);

  let message = `**Squad Task Complete** (${duration}s)\n\n`;
  if (isTimeout) message += "⚠️ Task timed out\n\n";
  message += `**Results:** ${completedCount} completed, ${failedCount} failed\n\n`;

  for (const result of results) {
    const icon = result.status === "completed" ? "✓" : "✗";
    message += `${icon} **${result.role}** (${(result.durationMs / 1000).toFixed(1)}s)\n`;
    if (result.error) message += `  Error: ${result.error}\n`;
    else if (result.output) {
      const preview = result.output.slice(0, 200);
      message += `  ${preview}${result.output.length > 200 ? "..." : ""}\n`;
    }
  }

  this.ctx.ui.notify(`Squad task complete: ${completedCount}/${results.length} members`, "info");
}
```

## Benefits

1. **True Parallelism** - Main agent doesn't wait
2. **Better UX** - User sees immediate response
3. **Efficient Resource Use** - No blocked threads
4. **Scalable** - Can dispatch dozens of tasks
5. **Resilient** - Timeout handling and cleanup

## Testing

All existing tests pass:
```
✔ 12 tests pass
✔ 8 suites pass
✖ 0 tests fail
```

TypeScript compilation: ✅ Pass

## Files Modified

1. **`background-dispatcher.ts`** (NEW) - Background dispatcher implementation
2. **`index.ts`** - Updated to use BackgroundDispatcher for non-blocking dispatch
3. **`PARALLEL_DISPATCH.md`** - Updated documentation

## Next Steps

Future enhancements:
- Add `get_task_status` action to check background task progress
- Add `cancel_task` action to cancel specific background task
- Store task results for later retrieval
- Add task history/log
