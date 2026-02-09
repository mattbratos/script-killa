# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

script-killa is a VS Code extension that transforms .fountain screenplay files into an editable teleprompter display. It parses Fountain dialogue, shows it in a clean scrolling view, and syncs edits bidirectionally back to the source file.

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

- **Entry point**: `src/extension.ts` — registers the `openTeleprompter` command, activates on `.fountain` files
- **Fountain parser**: `src/fountainParser.ts` — custom dialogue extractor with source offset tracking for write-back
- **Teleprompter panel**: `src/teleprompterPanel.ts` — manages a WebviewPanel with two-way sync (edits in webview → WorkspaceEdit on source, source changes → webview update)
- **Webview UI**: `media/teleprompter.js` + `media/teleprompter.css` — dark-themed teleprompter with auto-scroll, contenteditable dialogue, and toolbar controls
- **Types**: `src/types.ts` — shared interfaces (DialogueBlock, message types, config)
- **Build**: esbuild bundles to `dist/extension.js` (CJS format, vscode externalized). Webview assets in `media/` are served as static files via `webview.asWebviewUri()`
- **Tests**: Located in `src/test/`, compiled to `out/test/` before running via `@vscode/test-cli`

## VS Code Extension Notes

- Extension activates on `onLanguage:fountain` (when a `.fountain` file is opened)
- Command `script-killa.openTeleprompter` opens the teleprompter panel beside the editor
- Editor title bar shows a play button for `.fountain` files
- Configuration under `script-killa.*`: `hiddenCharacters`, `fontSize`, `fontFamily`, `scrollSpeed`
- Target VS Code version: 1.109.0+
