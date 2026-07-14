# @xiranite/tauri-migrate

Reusable AST tooling for moving Tauri backends into Xiranite without coupling the migration process to one application.

The tool has two deliberately separate layers:

1. `analyzeTauriProject` parses Rust with ast-grep/tree-sitter, discovers Cargo source roots, inventories `#[tauri::command]`, `generate_handler!`, arguments, return types, state, app handles, events, calls, and transitive native dependency evidence.
2. `applyStructuralRewrites` runs deterministic ast-grep codemods for Rust, JavaScript, TypeScript, and TSX. It is intended for imports, API renames, and other same-language structural edits—not automatic Rust-to-TypeScript business-logic translation.

## CLI

```powershell
bun run migrate:tauri -- generate D:\path\to\tauri-project `
  --out artifacts\tauri-migration\my-project `
  --config path\to\tauri-migration.json
```

The generated directory contains:

- `inventory.json`: machine-readable migration facts and decisions
- `commands.ts`: command argument/result contracts
- `adapter.ts`: Tauri-independent invocation boundary
- `REPORT.md`: human review report with source locations and events

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
