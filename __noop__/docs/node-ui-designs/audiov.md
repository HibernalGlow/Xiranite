# Audiov Node UI Design Note

## Basic Judgment

Audiov is an audio/video metadata and conversion planner. The UI should feel like a media processing console with a compact queue, codec settings, and command/result output. It must stop exposing PackU/Python integration fields as product UI.

## Core Tasks

1. Add audio or video file paths.
2. Inspect media stream and duration metadata.
3. Plan audio extraction, normalization, bitrate conversion, or report generation.
4. Preview the command/result before real execution.
5. Copy logs, command plans, and generated artifacts.

## Common Path

```text
paste media paths
-> inspect metadata
-> choose operation and codec/bitrate
-> preview plan
-> run
-> review result rows and logs
```

## Dangerous Actions

Overwrite and batch conversion can replace or create many files. Keep dry-run visible, show output path, and confirm overwrite/delete-source modes.

## Surface Layout

- Collapsed: media icon, status, queued file count, primary inspect/run action.
- Compact: path queue, operation toggle, dry-run switch, compact result/log tabs.
- Portrait: controls first, then metadata/result list, then logs.
- Full: left media queue and codec settings, center stream/result table, right command console and execution gate.

## Component Choices

Use `NodeSectionHeader`, ToggleGroup for short operation choices, table/list rows for media streams, command-console styling for generated commands, and restrained `bg-card` surfaces. Do not use broad gradients or permanent integration sidebars.

## PackU Rewrite

`packages/nodes/audiov` must become native TS. Remove `@xiranite/packu-node-runtime`, `python`, `sourceRoot`, and `moduleName` from package and app UI. Use injected platform helpers for media probing/execution.

## Tests

Run `bun run vitest run src/nodes/audiov`, package tests/build, architecture validation, typecheck, and QA screenshots for cards plus bento once bento QA is stable.
