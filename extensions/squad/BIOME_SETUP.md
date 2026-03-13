# Biome.js Setup ✅

## Overview

Biome.js has been initialized as the formatter and linter for the squad extension package, replacing the need for separate ESLint and Prettier configurations.

## Installation

```bash
pnpm add -D @biomejs/biome
```

## Configuration Files

### `biome.json`

Main configuration file with:
- **Formatter**: Tab indentation, 120 char line width
- **Linter**: Recommended rules with customizations
- **Files**: Includes `.ts` and `.json`, excludes `node_modules` and `*.test.ts`

### `.biomeignore`

Ignore file for Biome to skip:
- `node_modules`
- `*.test.ts`
- `dist`
- `build`

## Scripts

Added to `package.json`:

```json
{
  "scripts": {
    "lint": "biome lint .",
    "format": "biome format --write .",
    "biome": "biome check --write ."
  }
}
```

### Usage

**Format all files:**
```bash
pnpm run format
```

**Lint all files:**
```bash
pnpm run lint
```

**Check and fix (format + lint):**
```bash
pnpm run biome
```

## Rules Configuration

### Enabled Rules
- ✅ `recommended` - All recommended rules
- ✅ `noUnusedVariables` - Error on unused variables
- ✅ `noUnusedImports` - Error on unused imports
- ✅ `useConst` - Prefer `const` over `let`

### Disabled Rules
- ❌ `noNonNullAssertion` - Allows `!` operator (needed for TypeScript)
- ❌ `noExplicitAny` - Allows `any` type (needed for JSON parsing, event handling)

## Formatting Rules

- **Indent Style**: Tab
- **Indent Width**: 1
- **Line Width**: 120 characters
- **Quote Style**: Double quotes
- **Trailing Commas**: All
- **Semicolons**: Always

## Files Formatted

Biome formatted 12 files:
- `index.ts`
- `loader.ts`
- `manager.ts`
- `manager.test.ts`
- `overlay.ts`
- `overlay-actions.ts`
- `overlay-render.ts`
- `protocol.ts`
- `background-dispatcher.ts`
- `package.json`
- `tsconfig.json`
- `biome.json`

## Verification

All checks pass:
```bash
pnpm run biome    # ✅ No fixes needed
pnpm run lint     # ✅ No issues
pnpm run check    # ✅ TypeScript compiles
pnpm test         # ✅ 12 tests pass
```

## Benefits

| Benefit | Description |
|---------|-------------|
| **Fast** | Biome is significantly faster than ESLint + Prettier |
| **Unified** | Single tool for formatting and linting |
| **Zero Config** | Sensible defaults out of the box |
| **TypeScript First** | Built-in TypeScript support |
| **Auto-Fix** | Automatically fixes many issues |

## Migration Notes

### From ESLint/Prettier
- Removed need for `.eslintrc`, `.prettierrc`
- Single `biome.json` configuration
- Faster execution times
- Better TypeScript integration

### Import Protocol
Biome enforces `node:` protocol for Node.js built-in modules:
```typescript
// Before
import { readFileSync } from "fs";

// After (enforced by Biome)
import { readFileSync } from "node:fs";
```

### Template Literals
Biome prefers template literals over string concatenation:
```typescript
// Before
return JSON.stringify(obj) + "\n";

// After (enforced by Biome)
return `${JSON.stringify(obj)}\n`;
```

## CI/CD Integration

Add to your CI pipeline:
```bash
# Check formatting and linting
pnpm run biome

# Fail if any issues
pnpm run lint
```

## Editor Integration

### VS Code

Install the **Biome** extension and add to `.vscode/settings.json`:
```json
{
  "editor.defaultFormatter": "biomejs.biome",
  "editor.formatOnSave": true
}
```

### Other Editors

See [Biome Editor Integrations](https://biomejs.dev/guides/integrations/) for other editor setups.

## Summary

Biome.js provides:
- ✅ Fast, unified formatting and linting
- ✅ TypeScript-first approach
- ✅ Sensible defaults
- ✅ Auto-fix capabilities
- ✅ Easy CI/CD integration

All code is now properly formatted and linted! 🎉
