# Endfield 2D Asset Extraction and WebUI Reproduction

This note records the local workflow used to inspect 2D assets from a legally
installed Endfield client. The extracted files are reference material for UI
and icon design only. Do not ship the game files, rehost them, or treat this
workflow as permission to redistribute them.

## Paths

The working copy used for this run was:

```text
Kit:        D:\1VSCODE\Projects\Xiranite\artifacts\reference\endfield-wuling\00-tools\endfield_research_kit
Game data:  E:\1GAME\Hypergryph Launcher\games\Endfield Game\Endfield_Data
2D output:  D:\1VSCODE\Projects\Xiranite\artifacts\reference\endfield-wuling\02-extracted-2d
```

The game argument must point to `Endfield_Data`, not the parent game folder.

## One-time setup

The AnimeStudio CLI targets .NET 9. The Scoop install is side-by-side and does
not replace the existing .NET 10 SDK:

```powershell
scoop install dotnet9-sdk
dotnet --list-sdks
```

From the research-kit root, initialize and build the CLI:

```powershell
git submodule update --init tools/AnimeStudio
.\scripts\animestudio\setup_dotnet9.bat
dotnet restore .\tools\AnimeStudio\AnimeStudio.CLI\AnimeStudio.CLI.csproj -p:RestoreIgnoreFailedSources=true -p:NuGetAudit=false
dotnet build .\tools\AnimeStudio\AnimeStudio.CLI\AnimeStudio.CLI.csproj -c Release -f net9.0-windows
```

Expected executable:

```text
tools\AnimeStudio\AnimeStudio.CLI\bin\Release\net9.0-windows\AnimeStudio.CLI.exe
```

## Export and filter 2D files

Run this from `Kit`. Use one AnimeStudio worker on a memory-constrained
machine. `--animestudio-asset-types` limits the conversion pass to the two
2D Unity types needed here; the later PowerShell pass removes map, enemy, and
auto-generated texture names.

```powershell
.\export_assets.bat --export-from-game --full-assets `
  --game-root "E:\1GAME\Hypergryph Launcher\games\Endfield Game\Endfield_Data" `
  --animestudio-asset-types Sprite Texture2D `
  --animestudio-jobs 1
```

Then run the repository helper from the Xiranite root:

```powershell
.\scripts\endfield\collect-wuling-2d-assets.ps1 `
  -ExportRoot ".\artifacts\reference\endfield-wuling\00-tools\endfield_research_kit\export_full" `
  -OutputRoot ".\artifacts\reference\endfield-wuling\02-extracted-2d"
```

The helper keeps PNGs under these groups:

```text
02-extracted-2d/
  01-characters/
  02-icons-materials/
  03-ui/
  selection-manifest.csv
```

It excludes names matching `map`, `enemy`, `palesent`, and
`^T_auto_generat`. The output files are hard links to the original export, so
the selection does not duplicate the PNG bytes on the same NTFS volume.

## Build the WebUI data bundle

`build_assets.py` only builds `webui/data/assets/index.json`; it does not create
the startup manifest. After an asset-only export, build a minimal CN story
bundle so the static app has its required manifest and language index:

```powershell
python .\scripts\story_builder\build.py `
  --languages CN `
  --default-language CN `
  --timeline-recovery never `
  --skip-reference `
  --skip-audio-link

python .\scripts\build_assets.py --mode full
```

The `--timeline-recovery never` option is appropriate when the goal is only
the Assets tab. Omit it for a full story rebuild that needs timeline recovery.

## Start and use the WebUI

Run the server from `Kit`, and leave that terminal open:

```powershell
python .\serve.py
```

Open this URL:

```text
http://127.0.0.1:8765/
```

Do not open `http://127.0.0.1:8765/manifest.json`. The application requests
`/data/manifest.json`, so the root manifest path is expected to return 404.

In the page, select the `Resources`/`资源` tab. Use the search box for a PNG
name or folder, then select an entry to inspect its preview and metadata. The
WebUI indexes the exported files under `export_full`; the filtered
`02-extracted-2d` directory remains the clean reference collection for direct
file browsing.

Useful checks:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8765/data/manifest.json
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8765/data/assets/index.json
```

Both requests should return HTTP 200. A request to `/manifest.json` returning
404 is not a WebUI failure.

## Stop and recover

Stop the server by identifying only the research-kit `serve.py` process:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*endfield_research_kit*serve.py*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId }
```

If an AnimeStudio export is interrupted, check for its remaining processes
before starting another export:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*AnimeStudio*' } |
  Select-Object ProcessId, ParentProcessId, CommandLine
```

Terminate only processes from this export run, then retry with
`--animestudio-jobs 1` or `2`. Do not kill unrelated .NET, Python, or Xiranite
processes.

## Current verified state

The verified local run produced 6,726 filtered PNGs:

```text
01-characters:      167
02-icons-materials: 1,311
03-ui:              5,248
```

The WebUI data bundle contains `webui/data/manifest.json` and an asset index
with 12,777 image entries. The local server at `127.0.0.1:8765` returned HTTP
200 for both data paths, and the Resources page loaded without browser console
errors.
