# @xiranite/svelte-migrate

AST-driven evidence and scaffolding for migrating Svelte frontends without treating source text as a set of regular-expression replacements.

- `svelte/compiler` parses component templates and script boundaries.
- OXC parses TypeScript/JavaScript imports, exports, runes, stores, and Tauri calls.
- Generated inventories are deterministic and record the Git source fingerprint.
- `converted` means suitable for codemod scaffolding, not behaviorally complete.

```powershell
bun run migrate:svelte -- generate D:\path\to\svelte-project `
  --out migration\project\frontend `
  --config migration\project\frontend-migration.json
```

Generated scaffold directories are disposable. Production code must not import them, and reviewed code must retain source provenance and characterization tests when moved into the application.
