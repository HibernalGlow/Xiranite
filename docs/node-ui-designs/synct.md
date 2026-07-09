# Synct Node UI Design Note

## Basic Judgment

Synct organizes files by extracted timestamps. The UI should show a timestamp timeline and conflict-aware archive plan.

## Core Tasks

1. Add file/folder paths.
2. Extract timestamps from metadata, names, or filesystem dates.
3. Build target archive/folder names.
4. Detect conflicts and missing timestamps.
5. Run organize/archive operations.

## Surface Layout

- Collapsed: timestamp icon, status, ready/conflict count.
- Compact: path queue, timestamp source toggle, dry-run, timeline summary.
- Portrait: controls, timeline lanes, conflict/log tabs.
- Full: left path and extraction rules, center timeline grouped by date/time, right conflict summary and execution gate.

## Component Choices

Use timeline rows, badges for timestamp source, conflict list, `NodeSectionHeader`, and compact icon actions. Avoid metaphor labels; use direct labels like "时间来源", "目标路径", "冲突".

## PackU Rewrite

Implement timestamp extraction and target planning in TypeScript. Remove PackU runtime and Python/module fields.

## Tests

Cover timestamp parsing, target planning, conflicts, fake execution, surface matrix, and QA screenshots.
