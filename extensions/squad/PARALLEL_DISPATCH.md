# Parallel Dispatch Feature ✅

## Overview

The `parallel_dispatch` action allows sending **different prompts to different squad members** in parallel, enabling each member to perform their specialized task simultaneously.

## Use Case

Instead of sending the same prompt to all squad members, you can now assign role-specific tasks:

```json
{
  "action": "parallel_dispatch",
  "prompts": {
    "reviewer": "Review the authentication module for security vulnerabilities and code quality issues.",
    "scout": "Find all files related to authentication and user session management in the codebase.",
    "architect": "Analyze the authentication architecture and suggest improvements for scalability."
  }
}
```

Each member receives their customized instruction and executes in parallel.

## Tool Parameters

### `parallel_dispatch` Action

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | `"parallel_dispatch"` | Yes | Action type |
| `prompts` | `Record<string, string>` | Yes | Map of role to custom prompt |

**Example:**
```json
{
  "action": "parallel_dispatch",
  "prompts": {
    "reviewer": "Review for security issues",
    "scout": "Find related files"
  }
}
```

## Comparison: broadcast vs parallel_dispatch

### `broadcast` (Same Prompt to All)

```json
{
  "action": "broadcast",
  "prompt": "Analyze the authentication module"
}
```

**Result:** All members receive: "Analyze the authentication module"

**Use when:** You want all members to analyze the same thing from their perspective.

### `parallel_dispatch` (Different Prompts)

```json
{
  "action": "parallel_dispatch",
  "prompts": {
    "reviewer": "Review authentication code for security issues",
    "scout": "Find all authentication-related files",
    "architect": "Design improvements for the auth system"
  }
}
```

**Result:** Each member receives their specific task.

**Use when:** You need different members to perform different specialized tasks.

## Example Workflows

### 1. Code Review Workflow

```json
{
  "action": "parallel_dispatch",
  "prompts": {
    "reviewer": "Review src/auth/ for security vulnerabilities, code quality, and best practices.",
    "scout": "Find all test files for authentication and check coverage.",
    "architect": "Evaluate the authentication architecture for scalability and maintainability."
  }
}
```

**Parallel Execution:**
- Reviewer → Security/code review
- Scout → Test coverage analysis
- Architect → Architecture evaluation

### 2. Feature Implementation Workflow

```json
{
  "action": "parallel_dispatch",
  "prompts": {
    "scout": "Find existing payment processing code and dependencies.",
    "reviewer": "Review current payment implementation for issues.",
    "architect": "Design the new payment feature integration plan."
  }
}
```

### 3. Bug Investigation Workflow

```json
{
  "action": "parallel_dispatch",
  "prompts": {
    "scout": "Find all files modified in the last week related to user sessions.",
    "reviewer": "Review recent session-related changes for potential bugs.",
    "architect": "Analyze session architecture for root cause of timeout issues."
  }
}
```

## Output Format

The tool returns results from each member with their custom prompt shown:

```
Squad parallel dispatch completed (3 members):

── ✓ reviewer (2.3s) ──
Prompt: Review src/auth/ for security vulnerabilities...
[reviewer output]

── ✓ scout (1.8s) ──
Prompt: Find all test files for authentication...
[scout output]

── ✓ architect (3.1s) ──
Prompt: Evaluate the authentication architecture...
[architect output]
```

## LLM Usage Guidelines

The LLM can use `parallel_dispatch` like this:

**User:** "I need to improve our authentication system. Can you help?"

**LLM (thinking):** I should dispatch custom tasks to each squad member based on their expertise.

**LLM (tool call):**
```json
{
  "tool": "squad",
  "arguments": {
    "action": "parallel_dispatch",
    "prompts": {
      "reviewer": "Review the authentication module in src/auth/ for security vulnerabilities, code quality issues, and adherence to best practices. Focus on password handling, session management, and token security.",
      "scout": "Find all files related to authentication, user sessions, and tokens. Include test files and documentation. Report file paths and their purposes.",
      "architect": "Analyze the current authentication architecture. Identify scalability bottlenecks, single points of failure, and suggest improvements for high-availability scenarios."
    }
  }
}
```

## Error Handling

### Unknown Role

```json
{
  "action": "parallel_dispatch",
  "prompts": {
    "reviewer": "Review code",
    "unknown_role": "Do something"
  }
}
```

**Error:** `Unknown squad member(s): unknown_role. Use action "list_members" to see available members.`

### Empty Prompts

```json
{
  "action": "parallel_dispatch",
  "prompts": {}
}
```

**Result:** `No prompts provided. Specify at least one role-prompt pair.`

### Missing Prompts Parameter

```json
{
  "action": "parallel_dispatch"
}
```

**Error:** `Missing required parameter: prompts (map of role to prompt)`

## Implementation Details

### Parallel Execution

All custom prompts are dispatched simultaneously using `Promise.all()`:

```typescript
const promises = roles.map((role) => 
  manager.dispatchOne(role, prompts[role])
);
const results = await Promise.all(promises);
```

This ensures true parallel execution - all members start at the same time.

### State Persistence

Results are persisted in tool result details with `outputPreview` (2000 chars) for each member, enabling state reconstruction on session reload.

### Validation

Before dispatching:
1. Checks that `prompts` parameter is provided
2. Validates that all specified roles exist
3. Returns error if any role is unknown

## Best Practices

1. **Be Specific**: Tailor each prompt to the member's role
   - ✅ `reviewer`: "Review for security issues"
   - ✅ `scout`: "Find related files"
   - ❌ All members: "Analyze the code"

2. **Provide Context**: Each prompt should be self-contained
   - Include file paths or areas to focus on
   - Specify what to look for
   - Define the expected output format

3. **Balance Workload**: Assign tasks based on member capabilities
   - Reviewer → Code review, security, quality
   - Scout → File discovery, exploration
   - Architect → Design, patterns, improvements

4. **Clear Instructions**: Be explicit about what you want
   - ✅ "Find all test files for authentication and check coverage"
   - ❌ "Look at tests"

## Related Actions

- **`broadcast`** - Send same prompt to all members
- **`dispatch_to`** - Send prompt to single specific member
- **`get_status`** - Check progress of running members
- **`get_output`** - Get output from specific member
- **`cancel`** - Cancel running members

## Example Session

```
User: Help me improve the authentication system

LLM: I'll dispatch specialized tasks to each squad member.

[LLM calls squad tool with parallel_dispatch]

Squad parallel dispatch completed (3 members):

── ✓ reviewer (2.3s) ──
Prompt: Review src/auth/ for security vulnerabilities...

Security Issues Found:
1. Password hashing uses MD5 (weak)
2. No rate limiting on login
3. Session tokens don't expire
...

── ✓ scout (1.8s) ──
Prompt: Find all files related to authentication...

Files Found:
- src/auth/login.ts
- src/auth/session.ts
- src/auth/token.ts
- tests/auth/login.test.ts
...

── ✓ architect (3.1s) ──
Prompt: Analyze the authentication architecture...

Architecture Recommendations:
1. Implement OAuth2 for third-party auth
2. Add Redis for session storage
3. Use JWT with short expiry
...

LLM: Based on the squad analysis, here are the key improvements needed...
```

## Summary

The `parallel_dispatch` action enables **parallel, role-specific task assignment**, making the squad system much more powerful for complex workflows that require different expertise areas to work simultaneously on different aspects of a problem.
