# Squad Extension

A pi extension that enables the main agent to spawn squad members as background subprocesses, each with its own independent session.

## Phase 1: Discovery & Definition Parsing ✅

This phase implements the squad member discovery and parsing system.

### Features

- **Auto-discovery** of squad member `.md` files from:
  - Project-local: `<cwd>/.pi/squad/`
  - Global: `~/.pi/squad/`
- **Frontmatter parsing** for configuration (YAML format)
- **System prompt extraction** from markdown body
- **Deduplication** with project-local taking precedence over global
- **Validation** with warnings for malformed configs

### Files

- `loader.ts` - Core discovery and parsing logic
  - `discoverSquadMembers(cwd)` - Discover all squad members
  - `parseSquadMemberFile(role, raw, scope, sourcePath)` - Parse a single .md file
  - `validateSquadMember(config)` - Validate a config and return warnings
  - `SquadMemberConfig` - Type definition for squad member configuration

- `index.ts` - Extension entry point
  - Registers `session_start` event handler for initial discovery
  - Registers `squad-reload` command for manual re-discovery
  - Surfaces validation warnings via `ctx.ui.notify()`

### Squad Member File Format

```markdown
---
name: Reviewer
description: Reviews code and provides feedback.
tools: read
model: anthropic/claude-sonnet-4-5
thinking: medium
timeout: 120000
extensions: path/to/extension
noExtensions: false
env:
  CUSTOM_VAR: value
---
You are the Reviewer. Your job is to review code changes and provide constructive feedback.
Focus on code quality, security, and performance.
```

### Frontmatter Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | No | filename stem | Display name |
| `description` | string | No | `""` | Short description for LLM |
| `tools` | string | No | all tools | Comma-separated tool list |
| `model` | string | No | parent model | Provider/model ID |
| `thinking` | string | No | `"off"` | Thinking level |
| `timeout` | number | No | `120000` | Max execution time (ms) |
| `extensions` | string | No | `""` | Comma-separated extension paths |
| `noExtensions` | boolean | No | `false` | Disable all extensions |
| `env` | object | No | `{}` | Additional environment variables |

### Usage

The extension automatically discovers and loads squad members on session start.

**Commands:**
- `/squad-reload` - Manually reload squad members from disk

**Events:**
- Notifications are shown when squad members are loaded/reloaded
- Validation warnings are surfaced as warning notifications

### Testing

Test the loader directly:

```bash
node --input-type=module -e "
import { discoverSquadMembers } from './packages/extensions/squad/loader.ts';
const members = discoverSquadMembers(process.cwd());
console.log('Discovered:', members.length, 'members');
members.forEach(m => console.log(' -', m.name, '(', m.role, ')'));
"
```

### Next Phases

- **Phase 2**: Lifecycle Management - Subprocess spawning, RPC communication
- **Phase 3**: Tools & Commands - Custom tools for delegation
- **Phase 4**: UI Rendering - Status widget and dashboard
- **Phase 5**: State & Coordination - Result aggregation and cleanup
