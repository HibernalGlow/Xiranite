# @xiranite/tauri-migrate

Reusable AST tooling for moving Tauri backends into Xiranite without coupling the migration process to one application.

The tool has two deliberately separate layers:

1. `analyzeTauriProject` parses Rust with ast-grep/tree-sitter, discovers Cargo source roots, inventories `#[tauri::command]`, `generate_handler!`, arguments, return types, state, app handles, events, calls, and transitive native dependency evidence.
2. `applyStructuralRewrites` runs deterministic ast-grep codemods for Rust, JavaScript, TypeScript, and TSX. It is intended for imports, API renames, and other same-language structural edits—not automatic Rust-to-TypeScript business-logic translation.
3. `portTauriFrontend` copies a frontend source tree and rewrites import/export module specifiers through ast-grep nodes. It emits a source manifest and a review report so application components can be migrated wholesale while Tauri APIs remain visible as explicit host-adapter boundaries.

## CLI

```powershell
bun run migrate:tauri -- generate D:\path\to\tauri-project `
  --out artifacts\tauri-migration\my-project `
  --config path\to\tauri-migration.json
```

Frontend source port:

```powershell
bun run migrate:tauri -- frontend D:\path\to\tauri-project\ui\src `
  --out migration\my-project\frontend `
  --config migration\my-project\frontend-migration.json `
  --force
```

The config accepts `aliasReplacements`, `moduleReplacements`, and optional excluded source-tree prefixes. Rewrites apply only to AST module specifiers, so matching text in application strings and comments is left unchanged. The output includes `frontend-port.json` and `REPORT.md`; source Tauri imports and any unmapped adapters are reported separately.

The generated directory contains:

- `inventory.json`: machine-readable migration facts and decisions, including generator version and source Git fingerprint
- `commands.ts`: command argument/result contracts
- `adapter.ts`: Tauri-independent invocation boundary
- `REPORT.md`: human review report with source revision, declaration/name counts, source locations, and events

The source fingerprint records the Git commit, dirty state, and a SHA-256 hash of tracked changes plus untracked file contents. A clean source has `dirty: false` and `dirtyDiffHash: null`. This makes a refreshed inventory traceable to the exact source state instead of relying on its generation timestamp.

Conditional Rust implementations remain separate entries in `inventory.json`. For example, Windows and non-Windows `#[cfg]` variants of the same Tauri command retain their own native evidence and locations. `commands.ts` groups those variants under one command name, unions distinct public argument/result shapes, and retains every source location in `tauriCommandSources`.

Output is protected by default. Use `--force` only for a generated directory.

## Project decisions

AST evidence is intentionally kept separate from architectural decisions. A helper imported from a native crate may still be better rewritten in TypeScript. A config file can record that decision without deleting the evidence:

```json
{
  "nativeMarkers": ["my_native_core"],
  "commandOverrides": {
    "delete_files": "typescript-portable"
  }
}
```

Valid dispositions are `typescript-portable`, `native-required`, and `manual-review`.

## Node WASM feasibility audit

`feasibility` answers the ADR-0063 question "which nodes can actually become Extism plugins" from the
syntax tree of every `packages/nodes/<id>`, instead of from the node's name. It reads static, re-export
and dynamic import specifiers plus each package's own dependencies, and reports one tier per node:

| Tier | Meaning |
| --- | --- |
| `wasm-plugin` | only relative, pure-Node and allowlisted pure packages |
| `wasm-with-host-io` | needs filesystem, OS or process access, so it ships with host functions |
| `rust-host` | reaches machine capability (child processes, FFI, native bindings, shell integration) |
| `blocked-native` | depends on a heavy native library that is not promised as `wasm32` |
| `manual-review` | an unclassified dependency; no silent plugin verdict |

```powershell
bun run audit:node-feasibility                       # writes artifacts/node-wasm-feasibility.json
bun run migrate:tauri -- feasibility --node findz --blocked-native @some/gpu-pipeline
bun run audit:target-node-manifest -- --apply-feasibility artifacts/node-wasm-feasibility.json
```

The last command copies verdicts, reasons and up to three `file:line specifier` evidence rows into
`docs/xiranite-target-node-manifest.json`, which stays the only hand-authored source of truth; the
manifest gate then refuses to pass while a retained node is still `pending-audit` under `--strict`.

Classified tiers are evidence about dependencies, not a guarantee that a crate compiles to `wasm32`.
Anything in `blocked-native` or `manual-review` still needs a real target build before it is promised
as a plugin, and unknown specifiers are reported rather than guessed at.

## Structural rewrites

```ts
import { applyStructuralRewrites } from "@xiranite/tauri-migrate"

const result = applyStructuralRewrites(source, [{
  id: "tauri-core-import",
  language: "typescript",
  pattern: 'import { $$$MEMBERS } from "@tauri-apps/api/core"',
  replacement: 'import { $$$MEMBERS } from "@xiranite/api"',
}])
```

Add `ts-morph` only for migrations that require TypeScript symbol resolution or cross-file type information. The current generator creates new files, so a TypeScript project model would add cost without improving correctness.
