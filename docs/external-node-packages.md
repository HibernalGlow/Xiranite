# External Xiranite Node Packages

This document is the handoff contract for writing a Xiranite node outside this repository and integrating it later.

## What An External Node Is

An external node is a normal npm package that exports a Xiranite `NodeEntry`:

- UI entry: shell-less `Component.tsx`
- shared logic: pure `core.ts`
- command line: `cli.ts`
- native adapters: `platform.ts`
- optional standalone demo shell: `src/demo/CardShell.tsx`

The package must not import Xiranite app internals. Xiranite is the consumer.

## Required Package Shape

```text
my-node-package/
  package.json
  tsconfig.json
  src/
    index.ts
    core.ts
    core.test.ts
    Component.tsx
    cli.ts
    platform.ts
    demo/
      CardShell.tsx
```

`src/index.ts` is the only integration entry Xiranite should import.

## Public Entry

```ts
import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "example",
    name: "Example",
    version: "0.1.0",
    category: "file",
    description: "Short description.",
    icon: "FileText",
    keywords: ["example"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
```

Do not export `cli`, `platform`, `demo`, or `CardShell` from `index.ts`.

## Package Manifest

Use this shape for local workspace development:

```json
{
  "name": "@xiranite/node-example",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "xiranite-example": "./dist/cli.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./core": {
      "types": "./dist/core.d.ts",
      "default": "./dist/core.js"
    },
    "./cli": {
      "types": "./dist/cli.d.ts",
      "default": "./dist/cli.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "bun test"
  },
  "dependencies": {
    "@xiranite/cli-runtime": "workspace:*",
    "@xiranite/contract": "workspace:*",
    "@xiranite/ui": "workspace:*"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "lucide-react": "^1.0.0"
  }
}
```

Before publishing outside the monorepo, replace `workspace:*` with published versions.

## Component Rules

`Component.tsx` is content only. Xiranite supplies card shells, dock panels, flow shapes, floating windows, and demo wrappers.

Allowed:

- `NodeComponentProps` from `@xiranite/contract`
- `@xiranite/ui` content primitives
- local component state derived from `host.getData` / `host.patchData`
- pasted input, local previews, logs, and CLI fallback messaging

Forbidden:

- `CardShell`, local `Panel`, shadcn `Card`, or nested card shells
- `@/store`, `@/components`, `@/lib`, or other Xiranite app imports
- `host.runNode`, `host.runner`, or any backend runner assumption
- fixed card dimensions such as `min-h-[320px]`
- fixed arbitrary grids such as `grid-cols-[1.1fr_1fr_130px]`

## Core And Platform Split

`core.ts` should contain pure logic and runtime-injected operations:

- parse inputs
- validate configs
- build plans
- transform data
- calculate stats
- execute through an injected runtime interface

`platform.ts` owns concrete native work:

- filesystem
- shell/subprocess
- Windows registry
- browser/network
- archive tools
- OS-specific behavior

This split keeps UI, CLI, tests, and future backend execution using the same logic without adapters.

## CLI Rules

Use `citty` through `@xiranite/cli-runtime`.

- `xiranite-example` should be directly executable.
- `xiranite example ...` can call the same CLI through the aggregate registry.
- No-arg TTY may enter Ink guided mode.
- No-arg non-TTY should return usage/error code for automation.
- CLI must not import `Component.tsx` or `@xiranite/ui`.
- JSON output should be available for scripts when useful.

## Integration Into Xiranite

Current integration is explicit:

1. Add the package dependency to root `package.json`.
2. Import the package default entry in `src/components/modules/registry.ts`.
3. Append `entry.def` to `MODULE_REGISTRY`.
4. Import the package default entry in `src/components/modules/ModuleRenderer.tsx`.
5. Add it to `packageModules`.

Only import the default package entry. Do not import `./cli`, `./platform`, or `./demo`.

## Validation

From the external package:

```powershell
bun test
bun run build
```

From the Xiranite repo after linking or copying the package:

```powershell
bun --filter @xiranite/node-example test
bun --filter @xiranite/node-example build
bun scripts/validate-node-architecture.ts --node example
bun run test:packages
bun run build:packages
bun run build
```

The architecture validator is intentionally stricter than TypeScript. Passing TypeScript is not enough; the node must preserve Xiranite's shell-less component and CLI/core boundaries.

## Codex Skill

A local Codex skill is installed at:

```text
C:\Users\30902\.codex\skills\xiranite-node-authoring
```

Use it from any repository with:

```text
Use $xiranite-node-authoring to create or review an adapter-free Xiranite node package.
```
