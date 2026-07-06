# Xiranite CLI Shims

Use `scripts/install-cli-shims.ts` to expose the migrated TypeScript CLIs as system commands without deleting the old Python installation.

The script writes managed shim files into a target directory:

- `xiranite.cmd`
- `x<node>.cmd` for every migrated node package under the current CLI naming policy
- optional legacy aliases: `anode.cmd`, `aestiv.cmd`, `aestiva.cmd`

Default target:

```powershell
~\.xiranite\bin
```

Recommended flow:

```powershell
bun run build:packages
bun scripts/install-cli-shims.ts --dry-run --legacy-aliases
bun scripts/install-cli-shims.ts --force --legacy-aliases
```

Then place the target directory before Python Scripts in the user `PATH`. For the current PowerShell session:

```powershell
$env:Path = "$HOME\.xiranite\bin;$env:Path"
```

The shims are intentionally small and reversible. They call the built JS files with Bun, for example:

```cmd
bun "D:\1VSCODE\Projects\Xiranite\packages\cli\dist\index.js" %*
```

Safety rules:

- `--dry-run` prints planned writes without touching the filesystem.
- Existing unmanaged files are skipped unless `--force` is passed.
- Existing managed Xiranite shims are safe to overwrite.
- The script checks that `dist/cli.js` files exist and asks you to run `bun run build:packages` if they are missing.

The legacy aliases dispatch to the aggregate `xiranite` CLI. Keep them disabled unless you deliberately want the old Python command names to resolve to Xiranite.
