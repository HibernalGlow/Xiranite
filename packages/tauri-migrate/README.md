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

## Node host-requirement audit

`feasibility` answers the ADR-0073 question "which host service does this native crate still need" from the
syntax tree of every `packages/nodes/<id>`, instead of from the node's name. It reads static, re-export and
dynamic import specifiers plus each package's own dependencies, and also resolves the local call shape of
every surface file (which function calls the process API, which function recurses over a directory listing),
because a node may carry several requirements:

| Requirement | Meaning |
| --- | --- |
| `pure-logic` | nothing above: no file, process, network or OS service reaches the node core |
| `file-io` | reads or writes files under a root the host grants (`node:fs`, file-mutation services) |
| `recursive-enumeration` | the crate walks a directory tree itself (recursive `walk`/`listDir` cycle) |
| `external-process` | spawns a program that must be on the host's registered-command allowlist |
| `network` | an MCP, WebSocket or HTTP client reaches the node core |
| `os-native` | recycle bin, registry, shell integration, filesystem watcher, clipboard |
| `no-host-free-answer` | a binding or unclassified dependency the host cannot answer for free (`@parcel/watcher`, `@xiranite/findz-native`) |

`node:child_process` alone is not a requirement: `docs/migration/node-native-shape.md` measured that 22 of
the 41 retained nodes import it only for a byte-identical `readClipboardText()` block whose sole consumer is
`cli.ts`, so spawn evidence is dropped when it is confined to that block and not reached from `core.ts`.
`node:os`, `node:process` and `node:worker_threads` are host-free in native Rust and no longer count as IO.

The CLI/TUI/help/interaction sources and test files are excluded from the scanned surface: those faces are
rebuilt in Rust with clap and ratatui and never ship inside the crate (ADR-0069), so their Node imports
would otherwise score every node as coupled.

```powershell
bun run audit:node-feasibility                       # writes artifacts/node-host-requirements.json
bun run migrate:tauri -- feasibility --node findz --os-native @some/gpu-pipeline
bun run audit:target-node-manifest -- --apply-feasibility artifacts/node-host-requirements.json
```

The last command copies verdicts, reasons and up to three `file:line marker` evidence rows into
`docs/xiranite-target-node-manifest.json`, which stays the only hand-authored source of truth; the
manifest gate then refuses to pass while a retained node is still `pending-audit` under `--strict`.
`artifacts/` is gitignored, so the JSON is a regenerable report — the committed record is the manifest.

Current measured verdict (44 node directories): `file-io` 41, `recursive-enumeration` 24,
`external-process` 14, `os-native` 8, `network` 2, `no-host-free-answer` 1 (`findz`), `pure-logic` 1
(`linedup`); the three `hold-unmigrated` ids stay `pending-audit` because the manifest gate only scores
retained nodes.

Requirements are evidence about dependencies, not a promise that the crate needs no further work: a node may
carry several of them, and `no-host-free-answer` marks exactly the places where the host still owes a decision.

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
