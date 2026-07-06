# Xiranite Node Authoring Guide

This guide defines the adapter-free package contract for Xiranite nodes. Use it when migrating an aestivus adapter, writing a node in an external repository, or reviewing whether a node package can be installed independently without polluting Xiranite.

For a handoff-style guide aimed at authors working outside this repository, see [external-node-packages.md](external-node-packages.md).

## Package Shape

Each node is an independent npm package under the Bun workspace:

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
    demo/
      CardShell.tsx
```

For an external repository, keep the same `src/` shape and publish the package as `@xiranite/node-<id>` or another scoped name. Xiranite should consume it through its public package API only.

## Public Contract

The package main entry is the Xiranite integration surface:

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
    description: "Short user-facing description.",
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

Do not export `CardShell`, `demo`, `platform`, or CLI symbols from `src/index.ts`. The package may expose `./cli` and `./core` subpaths in `package.json`, but Xiranite integration must use the default `NodeEntry`.

## package.json

Use ESM, publishable files, a package-local binary, and explicit subpath exports:

```json
{
  "name": "@xiranite/node-example",
  "version": "0.1.0",
  "type": "module",
  "private": false,
  "bin": {
    "xexample": "./dist/cli.js"
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

External packages should replace workspace ranges with published versions before publishing.

## Core Logic

`core.ts` is pure logic shared by UI, CLI, and tests.

Allowed:

- Data parsing, validation, planning, transforms, scoring, formatting, state reducers.
- Runtime injection interfaces such as `readFile(path)`, `writeFile(path, data)`, `listDir(path)`, `fetch(url)`.
- Deterministic functions that can run in Bun tests without the real filesystem unless a test injects a fake runtime.

Forbidden:

- `node:*` imports.
- Direct `Bun`, `process`, filesystem, path, registry, shell, or network calls.
- React, Ink, Xiranite store, DOM, Electron, or browser APIs.

Put Node/Bun filesystem, shell, registry, browser, and network adapters in `platform.ts`.

## Component

`Component.tsx` is shell-less content. Xiranite provides the outer card, flow shape, dock panel, floating window, or demo wrapper.

Rules:

- Accept only `NodeComponentProps` from `@xiranite/contract`.
- Use `host.getData`, `host.patchData`, `host.clipboard`, and `host.downloadText`.
- Never call `host.runNode`, `host.runner?.runNode`, or any backend runner from `Component.tsx`.
- Never import from `@/store`, `@/components`, `@/lib`, or any Xiranite app path.
- Use `@xiranite/ui` primitives (`NodeContent`, `NodeHeader`, `NodeBody`, `NodeFooter`, `Field`, `TextArea`, `ActionButton`, `IconButton`, `SegmentButton`, `StatPill`, `ResultView`, `LogView`).
- Do not define local `Panel`, local card shells, nested card layouts, or shadcn `Card` wrappers in the node component.
- Do not hard-code card-sized layout constraints such as `min-h-[320px]`, `min-h-[330px]`, or fixed multi-column grids such as `grid-cols-[1.1fr_1fr_130px]`.

Native filesystem, registry, shell, browser, and network execution belongs to the package CLI or the Xiranite backend service. Keep the component usable for local state, pasted input, previews that can run in `core.ts`, and logs that explain the CLI/backend fallback.

## Demo Shell

`src/demo/CardShell.tsx` is optional and only for standalone demos. It may render a card-like outer frame, but it must not appear in `src/index.ts` exports and must not be required by Xiranite.

## CLI

`cli.ts` is command-line only. It can use `citty`, `ink`, and `@xiranite/cli-runtime`, but it must not render or import the package React UI component.

Rules:

- No args in a TTY enters an Ink guided mode.
- No args in a non-TTY exits with code `2` and a usage error.
- Explicit commands use citty-style flags and subcommands.
- CLI display names should use `nodeCliName("<node-id>")`; package `bin` fields are generated by `bun run sync:cli-bins`.
- CLI reads/writes files, shells out, fetches, and talks to native systems through `platform.ts`, then calls `core.ts`.
- JSON output should be available for automation when useful.
- The binary must be executable after `bun --filter @xiranite/node-<id> build`.

## Xiranite Integration

Current integration is explicit:

1. Add the package to root `package.json` dependencies.
2. Import the package default entry in `src/components/modules/registry.ts` and append `entry.def`.
3. Import the package default entry in `src/components/modules/ModuleRenderer.tsx` and add it to `packageModules`.
4. Do not import `cli.ts`, `platform.ts`, `demo/*`, or any non-public app internals.

Future plugin discovery can replace the static imports, but node packages must still obey the same public contract.

## Validation

Run these before considering a node complete:

```powershell
bun --filter @xiranite/node-example test
bun --filter @xiranite/node-example build
bun scripts/validate-node-architecture.ts --node example
bun run test:packages
bun run build:packages
bun run build
```

The validation script is the preferred architecture gate. If you need to debug a failure manually, run these equivalent scans from the repo root:

```powershell
rg -n "NodeCardSchema|NodeCardProps|card:\s*NodeCard" packages src
rg -n "host\.runNode|host\.runner|runner\?:" packages src
rg -n "<Panel|function Panel|const Panel" packages/nodes -g Component.tsx
rg -n "min-h-\[3|grid-cols-\[1\.1fr|grid-cols-\[.*130px" packages/nodes -g Component.tsx
rg -n "CliHost|CliCommand|cli\?:" packages/contract/src/index.ts
rg -n "@xiranite/contract" packages/nodes -g cli.ts
rg -n "demo|CardShell|from \"\.\/cli|from \"\.\/platform|from \"\.\/demo" packages/nodes -g index.ts
```

Expected result: only intentional demo `CardShell` files may contain demo shell styles; package `Component.tsx` and `index.ts` must stay clean.

## Migration Checklist

- Map the original Python adapter action surface to TypeScript input and output types.
- Move pure parsing/planning/state logic into `core.ts`.
- Move filesystem, shell, registry, browser, and network work into `platform.ts`.
- Implement `run<NodeId>` in `core.ts` with an injected runtime.
- Add focused `core.test.ts` coverage for parsing, planning, dry-run, execution through fake runtimes, and undo/history if supported.
- Implement `Component.tsx` as one dense, shell-less content surface.
- Implement `cli.ts` with both guided and explicit command paths.
- Confirm package build, package tests, repo package tests, repo build, and architecture scans all pass.
