# Xiranite tsgo / TypeScript 7 migration plan

> Last verified: 2026-07-08. TypeScript 7 / tsgo is moving quickly; re-check the official TypeScript blog before changing package pins.

## Official status

References:

- TypeScript 7.0 RC: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/
- TypeScript 7.0 Beta: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-beta/
- Native previews / `tsgo`: https://devblogs.microsoft.com/typescript/announcing-typescript-native-previews/
- Native port background: https://devblogs.microsoft.com/typescript/typescript-native-port/

Current official position:

- TypeScript 7.0 RC is installed as `typescript@rc` and exposes the usual `tsc` command.
- Nightlies still use `@typescript/native-preview` and expose the `tsgo` binary.
- The native compiler is the Go port formerly known as Corsa.
- Microsoft reports roughly 10x speedups for many builds because of native code and shared-memory parallelism.
- Stable programmatic API is not available in 7.0 RC; official guidance says it is expected no earlier than TypeScript 7.1.
- `@typescript/typescript6` exists as a compatibility package for tools that still need the TypeScript 6 API while `tsc` is moved to TypeScript 7.

## Xiranite readiness summary

| Area | Current Xiranite use | tsgo readiness | Decision |
|---|---|---:|---|
| Root typecheck | `bun run typecheck` -> `tsgo --noEmit` (rollback: `typecheck:tsc`) | Good | Switched in PR 4 |
| App build check | root `build` runs `tsc -b` before Vite | Good | Safe to compare with TS7, but keep old path until scripts are fixed |
| Package emit | every package uses `tsgo -p tsconfig.json` (rollback: `build:tsc`) | Good | Switched in PR 4 |
| JSX / React | React 19 + `jsx: react-jsx` | Good | No known blocker |
| Declaration emit | packages emit `.d.ts` | Good | Candidate for tsgo comparison |
| Project references | root has only app/node refs; packages are built by scripts | Partial | Good future target, not fully wired today |
| Programmatic TS API | two scripts import `typescript` | Blocked | Must refactor or keep TS6 API side-by-side |
| Vitest | normal test runner, not TS typecheck mode | Likely OK | Keep using current test flow |
| typescript-eslint | no ESLint config currently found | Not a blocker today | Revisit if lint is added |

## Current blockers

There are two direct TypeScript compiler API imports:

```text
scripts/generate-node-registries.ts
scripts/migrate-node-ui-to-app.ts
```

Both use:

```ts
import * as ts from "typescript"
```

They parse node package `src/index.ts` files to extract literal `NodeDef` metadata. This is the hard migration blocker because TypeScript 7.0 RC does not provide a stable programmatic API.

Do not replace the root `typescript` package with TypeScript 7 until this is handled, unless you also keep a TypeScript 6 API package for these scripts.

## Phase 0: measure current TS 5.9 baseline

Run from repo root:

```powershell
Measure-Command { bun run typecheck }
Measure-Command { bun run build:packages:lazy }
Measure-Command { bun run build }
```

Record:

- total wall time;
- number of packages rebuilt by `build:packages:lazy`;
- whether `generate-node-registries` runs cleanly;
- whether package declaration emit remains stable.

## Phase 1: side-by-side tsgo smoke test

Do not touch existing scripts yet.

Install native preview side-by-side:

```powershell
bun add -d @typescript/native-preview
```

Add optional scripts to root `package.json`:

```json
{
  "scripts": {
    "typecheck:tsgo": "bun run generate:node-registries && tsgo --noEmit",
    "typecheck:tsgo:raw": "tsgo --noEmit",
    "build:refs:tsgo": "tsgo -b --checkers 4 --builders 4"
  }
}
```

Notes:

- `typecheck:tsgo` still runs `generate-node-registries`, so it still depends on the TypeScript 5/6 JS API through the current `typescript` package.
- `typecheck:tsgo:raw` is useful when generated files are already fresh.
- `build:refs:tsgo` only exercises current root project references, which are `tsconfig.app.json` and `tsconfig.node.json`. It does not build all packages because root references are not wired for them yet.

Run:

```powershell
bun run typecheck
bun run typecheck:tsgo
bun run build:refs:tsgo
```

Expected:

- Type errors should match current `tsc --noEmit` or be explainable.
- If `--checkers` / `--builders` are not accepted by the installed preview version, record that and retry with plain `tsgo -b`.

## Phase 2: make registry scripts independent of TypeScript API

Goal: remove direct `import * as ts from "typescript"` from regular build paths.

### Preferred option: replace TS API with `oxc-parser`

Use `oxc-parser` as the direct replacement for the TypeScript compiler API in:

```text
scripts/generate-node-registries.ts
scripts/migrate-node-ui-to-app.ts
```

Install:

```powershell
bun add -d oxc-parser @oxc-project/types
```

As of this check, `oxc-parser` is available and exposes:

```ts
import { parseSync } from "oxc-parser"
```

The parser returns an ESTree / TS-ESTree-shaped AST. For the node entry files, parse with:

```ts
const result = parseSync(indexPath, sourceText, {
  lang: "ts",
  sourceType: "module",
  astType: "ts",
  preserveParens: true,
})
```

Implementation shape:

1. Create a shared helper, for example:

```text
scripts/lib/read-node-def.ts
```

2. Move the duplicated `readNodeDef`, `parseNodeDefLiteral`, `objectLiteralFromExpression`, and `propertyName` logic out of both scripts.
3. Reimplement that helper against Oxc AST nodes.
4. Import it from both scripts:

```ts
import { readNodeDef } from "./lib/read-node-def.js"
```

5. Remove all direct `typescript` imports from the regular build scripts.

The Oxc helper must support the exact current entry shapes:

```ts
export const def = {
  id: "findz",
  name: "Findz",
  version: "0.1.0",
  category: "file",
  description: "Search files and archive members with SQL-like filters.",
  icon: "Search",
  keywords: ["search", "archive", "filter", "find", "zip"],
} satisfies NodeDef
```

and the defensive shape already handled by the old code:

```ts
const entry = {
  def: {
    id: "example",
    name: "Example"
  },
  core,
}
```

Oxc AST handling checklist:

- `VariableDeclaration` / `VariableDeclarator` named `def`.
- `Property` named `def` inside object expressions.
- `TSSatisfiesExpression` wrappers around object expressions.
- `TSAsExpression` wrappers if any old code uses `as`.
- `ParenthesizedExpression` wrappers.
- `ObjectExpression` properties with string literal values.
- `ArrayExpression` for `keywords`, with string literal elements only.
- Throw a clear error if any required field is missing or non-literal.

Pros:

- Works with TS7 now.
- Faster generator.
- Smaller migration than introducing package metadata JSON.
- Keeps the current node package shape.
- Handles both known TS API call sites at once.

Cons:

- Still an AST dependency.
- Must maintain compatibility with the TypeScript syntax forms used in node entries.
- Oxc AST is TS-ESTree-shaped, so node property names differ from the TypeScript compiler API.

Test strategy:

- Add fixture tests for `scripts/lib/read-node-def.ts`.
- Fixtures should cover plain `def`, `def satisfies NodeDef`, parenthesized object, inline `entry.def`, and invalid non-literal fields.
- Run `bun run generate:node-registries` before and after the Oxc rewrite and require no generated diff.
- Run `bun scripts/migrate-node-ui-to-app.ts --audit` before and after and require identical output.

### Rejected for now: move `NodeDef` metadata to JSON

Moving metadata into `packages/nodes/<id>/node.json` would also remove the TS API blocker, but it changes package shape for all nodes and introduces drift risk between JSON metadata and exported `def`.

Do not choose this path for the tsgo migration unless Oxc parsing proves unreliable.

If this path is ever chosen later:

- Generate `src/index.ts` `def` from `node.json`, or
- Add validation comparing `node.json` with exported `def`, or
- Make `src/index.ts` import JSON metadata with `with { type: "json" }` if package build supports it cleanly.

Do not use regex for TypeScript source. Oxc is the chosen path.

### Deferred option: wait for TypeScript 7.1 API

If no one wants to touch generator scripts yet, keep the current `typescript@5.9/6` API package and use `@typescript/native-preview` only for side-by-side typecheck.

This is acceptable as a short-term validation strategy, but it is not a full migration.

## Phase 3: package build strategy

Current package builds:

- `packages/*/package.json` all use `tsc -p tsconfig.json`.
- `packages/nodes/*/package.json` all use `tsc -p tsconfig.json`.
- `scripts/build-packages-lazy.ts` sequentially runs each package build when stale.

Once script API blockers are removed, add experimental TS7 scripts rather than replacing current scripts immediately:

```json
{
  "scripts": {
    "build:packages:tsgo": "bun scripts/build-packages-lazy.ts --compiler tsgo",
    "build:packages:tsc7": "bun scripts/build-packages-lazy.ts --compiler tsc"
  }
}
```

Then modify `scripts/build-packages-lazy.ts` to accept a compiler argument:

```ts
const compiler = readArg("--compiler") ?? "tsc"
const script = `${compiler} -p tsconfig.json`
```

Better long-term plan:

- Add `composite: true` and package-level references.
- Generate root references for `packages/*` and `packages/nodes/*`.
- Use `tsgo -b --checkers 4 --builders 4` for monorepo builds.

Do this after the side-by-side smoke test, not before.

## Phase 4: TypeScript 7 RC / stable package strategy

Do not replace `typescript` with `typescript@rc` while the scripts still import the TS API.

After Phase 2:

Option A, native preview nightly:

```powershell
bun add -d @typescript/native-preview
```

Use `tsgo` scripts.

Option B, TypeScript 7 RC:

```powershell
bun add -d typescript@rc
```

Use normal `tsc` scripts.

Option C, side-by-side TypeScript 7 compiler and TypeScript 6 API:

Use only if other tooling still imports the TypeScript API.

For npm, Microsoft documents aliasing `typescript` to `@typescript/typescript6` and adding a second alias for TypeScript 7. With Bun, verify binary resolution before committing this setup. The intended shape is:

```json
{
  "devDependencies": {
    "typescript": "npm:@typescript/typescript6@^6.0.0",
    "typescript-7": "npm:typescript@rc"
  }
}
```

Validation required:

```powershell
bunx tsc --version
bunx tsc6 --version
bunx tsgo --version
```

If Bun does not expose the expected alias binaries, do not use this package layout; keep `@typescript/native-preview` for experiments instead.

## TSConfig notes

Current app config already has:

```json
{
  "target": "ES2022",
  "types": ["vite/client", "node"],
  "strict": true,
  "rootDir": undefined,
  "module": "ESNext",
  "moduleResolution": "bundler"
}
```

Packages generally have:

```json
{
  "target": "ES2022",
  "module": "NodeNext",
  "moduleResolution": "NodeNext",
  "declaration": true,
  "declarationMap": true,
  "outDir": "dist",
  "rootDir": "src",
  "skipLibCheck": true
}
```

Action items before full TS7:

- Keep `types` explicit in app and scripts configs.
- Keep package `rootDir: "src"` explicit.
- Confirm no deprecated TS6 options are present.
- Do not add `isolatedDeclarations` during the first tsgo migration; it is a separate cleanup project.

## Validation matrix

Run each row before changing default scripts:

| Command | Current TS | tsgo/native | Must match |
|---|---:|---:|---|
| `bun run generate:node-registries` | yes | after Phase 2 | generated files unchanged |
| `bun run typecheck` | yes | `bun run typecheck:tsgo` | no new diagnostics |
| `bun run build:packages:lazy` | yes | experimental compiler script | same dist declarations |
| `bun run test:unit` | yes | yes | pass |
| `bun run test:packages` | yes | after package build switch | pass |
| `bun run build` | yes | after package build switch | pass |

Compare generated declaration output after a package build:

```powershell
git diff -- packages/**/dist/**/*.d.ts packages/nodes/**/dist/**/*.d.ts
```

If dist files are not tracked, compare file counts and selected public `.d.ts` contents.

## Suggested PR split

### PR 1: tsgo smoke scripts

- Add `@typescript/native-preview`.
- Add `typecheck:tsgo` and `build:refs:tsgo`.
- Document baseline timings.
- Do not change default `typecheck` or `build`.

### PR 2: remove TypeScript API from registry scripts

- Refactor `scripts/generate-node-registries.ts`.
- Refactor `scripts/migrate-node-ui-to-app.ts`.
- Use `oxc-parser` through a shared `scripts/lib/read-node-def.ts` helper.
- Add tests or golden output checks for generated registries.

### PR 3: package emit experiment

- Add compiler flag support to `scripts/build-packages-lazy.ts`.
- Run package builds with current `tsc` and tsgo/TS7.
- Compare declaration output.

### PR 4: full default switch

- Replace default typecheck/build compiler only after PRs 1-3 pass.
- Keep rollback scripts for at least one release.
- Update docs and CI.

**Status: done (2026-07-08).**

- `typecheck` now runs `tsgo --noEmit`; `typecheck:tsc` is the rollback.
- Every package `build` script now runs `tsgo -p tsconfig.json`; `build:tsc` is the rollback.
- Root `build:packages:turbo` uses tsgo via the package `build` scripts; `build:packages:tsc` is the rollback.
- `turbo.json` defines a `build:tsc` task (`dependsOn: ["^build:tsc"]`) for the rollback path.
- The root app `build` still uses `tsc -b` before Vite; switching it to `tsgo -b` is deferred until the pre-existing `NodeStateCapability` project-reference errors (unrelated to tsgo) are resolved.
- No CI workflows exist in this repo, so nothing to update there.

## Do not do

- Do not replace root `typescript` with `typescript@rc` while `scripts/generate-node-registries.ts` or `scripts/migrate-node-ui-to-app.ts` still import `typescript`.
- Do not assume `tsgo -b` covers all packages; root project references currently do not include package tsconfigs.
- Do not introduce regex parsing for TypeScript source. Use `oxc-parser`.
- Do not combine TS7 migration with React Compiler, Vite chunk changes, or node contract refactors.
- Do not rely on Bun runtime transpilation as evidence that `tsgo` package emit works; they are separate paths.
