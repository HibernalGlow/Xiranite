# Timeu Node UI Design Note

## Basic Judgment

Timeu backs up and restores timestamps. The UI should look like a timestamp ledger where users can compare stored and current times before applying changes.

## Core Tasks

1. Add file/folder paths.
2. Backup timestamps into records.
3. Restore timestamps from records.
4. Compare current, stored, and target timestamps.
5. Report missing records and failed writes.

## Surface Layout

- Collapsed: clock icon, status, record/missing count.
- Compact: mode toggle, path queue, dry-run switch, ledger summary.
- Portrait: controls, ledger list, errors/logs.
- Full: left backup/restore controls, center timestamp ledger rows, right missing-record errors and execution gate.

## Component Choices

Use table/list ledger rows, `NodeSectionHeader`, direct labels, copy/open actions, and restrained state colors for changed/missing/error rows.

## PackU Rewrite

Implement record parsing, backup planning, and restore planning in TypeScript. Remove PackU runtime and Python/module fields.

## Tests

Cover backup record generation, restore planning, missing records, fake execution, surface matrix, and QA screenshots.
