# Fire-and-Forget Workflow ✅

## Overview

The squad extension now implements a **true fire-and-forget pattern** inspired by the agent-team extension. After dispatching tasks, the main agent **continues the conversation** without polling or waiting.

## Key Principles

### 1. Context Injection via `before_agent_start`

Before each agent turn, the system prompt is dynamically updated with:
- Available squad members catalog
- Clear workflow instructions
- **Critical rules** about fire-and-forget
- Recent results (if any)

**Example System Prompt:**
```
You are a coordinator for squad members (specialist background agents).

## Available Squad Members
### Reviewer (reviewer)
Reviews code and provides feedback
**Tools:** read

### Scout (scout)
Explores the codebase and finds relevant files
**Tools:** find, grep, read, ls

## How to Work
- Use the `squad` tool to delegate tasks
- For parallel work, use `broadcast` or `parallel_dispatch`
- These actions are **NON-BLOCKING** - return immediately with task ID
- **After dispatching, CONTINUE the conversation - do NOT wait or poll**
- You will be automatically notified when tasks complete
- When notified, use `get_completed_outputs` to retrieve all results

## Critical Rules
1. **FIRE AND FORGET**: After calling broadcast/parallel_dispatch, immediately continue helping the user
2. **DO NOT POLL**: Never call get_status repeatedly - wait for automatic notification
3. **RETRIEVE WHEN READY**: Only call get_completed_outputs after seeing completion message
4. **ONE CALL PER TASK**: Use task ID from dispatch to retrieve outputs later
```

### 2. Non-Blocking Dispatch Response

When dispatching, the response explicitly tells the agent to continue:

```
✅ Squad broadcast launched (NON-BLOCKING)

Task ID: `squad_abc123`
Members: reviewer, scout

**Continue the conversation** - you will be automatically notified when complete.
```

### 3. Automatic Completion Notification (Wakes Up Agent)

When tasks complete, a message is injected into chat **AND triggers agent turn**:

```
✅ Squad Task Complete (28.4s)

Task ID: squad_abc123
Results: 2 completed, 0 failed

✓ reviewer (15.2s)
  Security issues found...

✓ scout (8.7s)
  Found 12 files...

Use `squad get_completed_outputs "squad_abc123"` to retrieve full outputs.
```

**Key:** `triggerTurn: true` wakes up the agent automatically.

### 4. Agent Automatically Retrieves Outputs

Agent is woken up by notification and immediately retrieves:

```json
{
  "action": "get_completed_outputs",
  "task_id": "squad_abc123"
}
```

## Complete Workflow Example

### User Request
```
User: "Research our authentication system for security issues"
```

### Agent Dispatches (Fire)
```json
{
  "action": "parallel_dispatch",
  "prompts": {
    "reviewer": "Review authentication code for security vulnerabilities",
    "scout": "Find all authentication-related files",
    "architect": "Analyze auth architecture for security patterns"
  }
}
```

### Immediate Response (Forget)
```
✅ Squad parallel dispatch launched (NON-BLOCKING)

Task ID: `squad_abc123`
Members: reviewer, scout, architect

**Continue the conversation** - you will be automatically notified when complete.
```

### Agent Continues Conversation
```
Agent: "I've dispatched the security research to three specialists. While they're working, 
is there anything specific about the authentication system you'd like to discuss?"

User: "Yes, what are common auth vulnerabilities?"

Agent: "Common authentication vulnerabilities include:
1. Weak password hashing (MD5, SHA1)
2. Missing rate limiting on login
3. Session fixation attacks
4. JWT token issues...

[Continues natural conversation...]
```

### Automatic Notification (30s later) - WAKES UP AGENT
```
✅ Squad Task Complete (28.4s)

Task ID: squad_abc123
Results: 3 completed, 0 failed

✓ reviewer (15.2s)
  Security issues found: 1. Weak password hashing...

✓ scout (8.7s)
  Found 12 files: src/auth/login.ts...

✓ architect (22.1s)
  Architecture recommendations: 1. Add OAuth2...

Use `squad get_completed_outputs "squad_abc123"` to retrieve full outputs.
```

### Agent Automatically Retrieves Outputs (Woken Up)
```json
{
  "action": "get_completed_outputs",
  "task_id": "squad_abc123"
}
```

### Agent Presents Results
```
Agent: "The squad has completed their security research. Here's what they found:

### Reviewer Findings
- Weak password hashing (MD5)
- No rate limiting on login endpoints
- Session tokens don't expire

### Scout Findings
Found 12 authentication-related files:
- src/auth/login.ts
- src/auth/session.ts
- ...

### Architect Recommendations
1. Implement OAuth2 for third-party auth
2. Add Redis for session storage
3. Use JWT with short expiry

Shall I help implement any of these fixes?"
```

## Implementation Details

### before_agent_start Handler

```typescript
pi.on("before_agent_start", async (_event, ctx) => {
  const members = state.manager?.getMembers();
  if (!members || members.size === 0) return;

  const memberCatalog = Array.from(members.values())
    .map(m => `### ${m.config.name} (${m.config.role})\n${m.config.description}\n**Tools:** ${m.config.tools}`)
    .join("\n\n");

  const hasRecentResults = state.state.lastResults.size > 0;
  const resultSummary = hasRecentResults
    ? Array.from(state.state.lastResults.entries())
        .map(([role, r]) => `  - ${role}: ${r.status} (${(r.durationMs / 1000).toFixed(1)}s)`)
        .join("\n")
    : "";

  return {
    systemPrompt: `You are a coordinator for squad members...

## Available Squad Members
${memberCatalog}

## How to Work
- Use squad tool to delegate
- broadcast/parallel_dispatch are NON-BLOCKING
- **After dispatching, CONTINUE conversation - do NOT wait**
- You will be automatically notified when complete

## Critical Rules
1. **FIRE AND FORGET**: Continue immediately after dispatch
2. **DO NOT POLL**: Wait for automatic notification
3. **RETRIEVE WHEN READY**: Use get_completed_outputs after notification
4. **ONE CALL PER TASK**: Use task ID to retrieve

## Recent Results
${hasRecentResults ? resultSummary : "No recent results"}
`,
  };
});
```

### Dispatch Response

```typescript
case "broadcast": {
  const taskId = state.dispatcher!.dispatchAllBackground(prompt, parentSessionID, parentMessageID);
  return {
    content: [{
      type: "text",
      text: `✅ Squad broadcast launched (NON-BLOCKING)

Task ID: \`${taskId}\`
Members: ${roles.join(", ")}

**Continue the conversation** - you will be automatically notified when complete.`
    }],
    details: { action: "broadcast", dispatching: roles, taskId }
  };
}
```

### Completion Notification

```typescript
private notifyParent(task: BackgroundDispatchTask): void {
  let message = `✅ **Squad Task Complete** (${duration}s)\n\n`;
  message += `**Task ID:** ${task.id}\n`;
  message += `**Results:** ${completedCount} completed, ${failedCount} failed\n\n`;
  
  for (const result of results) {
    message += `${icon} **${result.role}**\n`;
    message += `  ${output_preview}\n`;
  }
  
  message += `Use \`squad get_completed_outputs "${task.id}"\` to retrieve full outputs.`;
  
  // TRIGGER TURN - wakes up agent to retrieve outputs
  this.pi.sendMessage(
    { customType: "squad-task-complete", content: message, display: true },
    { triggerTurn: true } // WAKES UP AGENT
  );
}
```

## Benefits

| Benefit | Description |
|---------|-------------|
| **Natural Flow** | Conversation continues without awkward waits |
| **No Polling** | Agent doesn't waste turns checking status |
| **Efficient** | Agent helps user while waiting |
| **Auto-Wakeup** | Notification triggers agent to retrieve outputs |
| **Clear UX** | Explicit instructions in every response |
| **Context-Aware** | System prompt updated each turn |

## Anti-Patterns (What NOT to Do)

### ❌ Bad: Polling After Dispatch
```
Agent: [dispatches]
→ Task ID: squad_abc123

Agent: "Let me check the status..."
squad get_status → 2 running

Agent: "Still waiting..."
squad get_status → 2 running

Agent: "Checking again..."
squad get_status → 2 running
```

### ✅ Good: Fire and Forget
```
Agent: [dispatches]
→ Task ID: squad_abc123

Agent: "I've dispatched the research. What else can I help with?"

User: "Tell me about common vulnerabilities..."

Agent: [continues natural conversation...]

[30s later - notification APPEARS AND WAKES AGENT]
✅ Squad Task Complete

Agent: [AUTOMATICALLY retrieves outputs]
squad get_completed_outputs "squad_abc123"
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

1. **`index.ts`** - Updated `before_agent_start` with full context injection
2. **`background-dispatcher.ts`** - Enhanced notification with task ID
3. **`FIRE_AND_FORGET_WORKFLOW.md`** - This documentation

## Summary

The fire-and-forget workflow provides a **natural, efficient conversation flow**:

1. **Context Injection** - System prompt updated before each turn
2. **Clear Instructions** - Explicit "continue conversation" messaging
3. **Non-Blocking** - Dispatch returns immediately
4. **Auto-Notification** - No polling needed
5. **Auto-Wakeup** - `triggerTurn: true` wakes agent to retrieve outputs
6. **Retrieve Automatically** - Agent retrieves outputs when notified

Main agent conversation flows naturally and wakes up automatically! 🎉
