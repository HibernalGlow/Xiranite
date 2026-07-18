# Snf Node UI Design Note

## Basic Judgment

Snf repairs numbered sequence folders. The UI should be a sequence repair table, not a generic PackU command wrapper.

## Core Tasks

1. Add folder paths.
2. Detect numeric sequence gaps, duplicates, and out-of-order names.
3. Preview before/after rename rows.
4. Run repair with dry-run by default.
5. Review repaired, skipped, and failed counts.

## Surface Layout

- Collapsed: sequence icon, status, gap count or repaired count.
- Compact: path input, rule controls, preview/run actions, small before/after list.
- Portrait: controls, sequence table, then logs.
- Full: left path/rule controls, center before/after sequence table with gap markers, right execution gate and result summary.

## Component Choices

Use `NodeSectionHeader`, table/list rows with gap markers, status badges, and icon buttons for scan/copy/reset. Color is limited to gap/error/success states.

## PackU Rewrite

Rewrite sequence detection and rename planning in TypeScript. Remove PackU runtime and Python/module fields.

## Tests

Cover gap detection, duplicate handling, dry-run planning, fake execution, surface matrix, and QA screenshots.
