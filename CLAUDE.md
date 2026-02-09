# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

script-killa is a VS Code extension for displaying .fountain screenplay files as a teleprompter. Currently in early development with basic scaffolding.

## Commands

```bash
# Build (type-check + lint + bundle)
pnpm run compile

# Watch mode for development
pnpm run watch

# Type checking only
pnpm run check-types

# Lint
pnpm run lint

# Run tests (compiles tests first, requires VS Code)
pnpm run test

# Package for production
pnpm run package
```

## Architecture

- **Entry point**: `src/extension.ts` - exports `activate()` and `deactivate()` functions per VS Code extension API
- **Build**: esbuild bundles to `dist/extension.js` (CJS format, vscode externalized)
- **Tests**: Located in `src/test/`, compiled to `out/test/` before running via `@vscode/test-cli`

## VS Code Extension Notes

- Commands are registered in `package.json` under `contributes.commands`
- Extension activates on command invocation (currently `script-killa.helloWorld`)
- Target VS Code version: 1.109.0+
