---
name: xiranite-node-author
description: Create, migrate, or review adapter-free Xiranite node packages. Use when implementing a new @xiranite/node-* package, converting an aestivus Python adapter to TypeScript, adding CLI support with citty/ink, checking shell-less Component boundaries, integrating an external node package into Xiranite, or auditing package independence and anti-pollution rules.
---

# Xiranite Node Author

Use this skill to keep Xiranite nodes independent, adapter-free, and safe to consume from the host app.

## First Reads

When working inside the Xiranite repo, read `docs/node-authoring.md` first. For a compact self-contained checklist, read `references/node-contract.md`.

## Workflow

1. Inspect the target package and nearby migrated nodes before editing.
2. Keep `core.ts` pure and shared by UI, CLI, and tests.
3. Put Node/Bun filesystem, shell, registry, browser, and network work in `platform.ts`.
4. Make `Component.tsx` shell-less content using `@xiranite/ui`.
5. Make `cli.ts` command-line only with citty explicit commands and Ink guided mode.
6. Export only the default `NodeEntry`, `Component`, and `core` from `src/index.ts`.
7. Validate the package, the workspace packages, and the architecture scans.

## Non-Negotiable Boundaries

- Do not use Python adapters.
- Do not import Xiranite app internals from a node package.
- Do not export `CardShell`, `demo`, `platform`, or CLI symbols from `src/index.ts`.
- Do not put `CliHost`, `CliCommand`, `cli?:`, `NodeCardSchema`, or `NodeCardProps` in `@xiranite/contract`.
- Do not render React UI components from CLI code.
- Do not put `node:*`, `Bun`, `process`, fs/path, shell, network, DOM, Electron, React, or Ink in `core.ts`.
- Do not use `host.runNode`; use optional `host.runner?.runNode`.
- Do not wrap node components in local `Panel`, local card shells, nested cards, or fixed card-sized layouts.

## Package Pattern

Use this package shape:

```text
packages/nodes/<node-id>/
  package.json
  tsconfig.json
  src/
    index.ts
    core.ts
    core.test.ts
    Component.tsx
    cli.ts
    platform.ts
    demo/CardShell.tsx
```

Main `src/index.ts` should look like:

```ts
import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: { id, name, version, category, description, icon, keywords },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
```

## Validation Commands

Run the focused package checks first:

```powershell
bun --filter @xiranite/node-<id> test
bun --filter @xiranite/node-<id> build
```

Then run workspace checks:

```powershell
bun run test:packages
bun run build:packages
bun run build
```

Run architecture scans:

```powershell
rg -n "NodeCardSchema|NodeCardProps|card:\s*NodeCard" packages src
rg -n "host\.runNode" packages src
rg -n "<Panel|function Panel|const Panel" packages/nodes -g Component.tsx
rg -n "min-h-\[3|grid-cols-\[1\.1fr|grid-cols-\[.*130px" packages/nodes -g Component.tsx
rg -n "CliHost|CliCommand|cli\?:" packages/contract/src/index.ts
rg -n "@xiranite/contract" packages/nodes -g cli.ts
rg -n "demo|CardShell|from \"\.\/cli|from \"\.\/platform|from \"\.\/demo" packages/nodes -g index.ts
```

Treat any match as a failure unless it is intentionally in `src/demo/CardShell.tsx`.

## Integration Rule

Current Xiranite integration is static: add the package dependency, add its default entry to `src/components/modules/registry.ts`, and add its default entry to `src/components/modules/ModuleRenderer.tsx`. Do not import package CLI, platform, or demo files into Xiranite.
