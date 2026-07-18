# Xiranite Node Contract

Use this reference when implementing or reviewing a node package without loading the full authoring guide.

## Required Public Files

- `src/index.ts`: default `NodeEntry`, named `Component`, and `export * from "./core.js"`.
- `src/core.ts`: pure logic and injected runtime interfaces.
- `src/core.test.ts`: focused tests for parser/planner/executor behavior.
- `src/Component.tsx`: shell-less React content for Xiranite.
- `src/cli.ts`: citty/ink CLI entry, no React UI component imports.
- `src/platform.ts`: Node/Bun/native integration.
- `src/demo/CardShell.tsx`: optional demo-only shell.

## Contract Types

- `NodeDef` identifies the node in Xiranite.
- `NodeComponentProps` is the only UI prop surface.
- `NodeHostApi` gives state, clipboard, download, env, component list/update, and optional runner access.
- `NodeEntry<TCore>` contains `{ def, Component, core }`.
- CLI types live in `@xiranite/cli-runtime`, not `@xiranite/contract`.

## Allowed Dependencies

Node packages may depend on:

- `@xiranite/contract`
- `@xiranite/cli-runtime`
- `@xiranite/ui`
- Package-specific runtime libraries

Use React and lucide as peer dependencies for UI packages.

## Forbidden Patterns

- `NodeCardSchema`, `NodeCardProps`, `card:` in contract.
- `CliHost`, `CliCommand`, or `cli?:` in contract.
- `host.runNode` anywhere; use `host.runner?.runNode`.
- `Panel`, local card shells, nested card UI, fixed card min-height, or fixed three-column grids in `Component.tsx`.
- Xiranite app imports such as `@/store/*`, `@/components/*`, `@/lib/*` inside packages.
- `node:*`, `Bun`, `process`, fs/path, shell, network, React, Ink, DOM, or Electron in `core.ts`.
- CLI importing `Component.tsx` or `@xiranite/ui`.
- Main `src/index.ts` exporting `cli`, `platform`, `demo`, or `CardShell`.

## Completion Gates

Use package-local checks:

```powershell
bun --filter @xiranite/node-<id> test
bun --filter @xiranite/node-<id> build
```

Use repo checks:

```powershell
bun run test:packages
bun run build:packages
bun run build
```

Use architecture scans:

```powershell
rg -n "NodeCardSchema|NodeCardProps|card:\s*NodeCard" packages src
rg -n "host\.runNode" packages src
rg -n "<Panel|function Panel|const Panel" packages/nodes -g Component.tsx
rg -n "min-h-\[3|grid-cols-\[1\.1fr|grid-cols-\[.*130px" packages/nodes -g Component.tsx
rg -n "CliHost|CliCommand|cli\?:" packages/contract/src/index.ts
rg -n "@xiranite/contract" packages/nodes -g cli.ts
rg -n "demo|CardShell|from \"\.\/cli|from \"\.\/platform|from \"\.\/demo" packages/nodes -g index.ts
```
