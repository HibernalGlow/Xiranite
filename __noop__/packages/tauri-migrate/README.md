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
