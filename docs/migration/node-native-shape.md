# Node native shape — which OS capability each retained node actually needs

Generated 2026-10-05 alongside `node-native-shape.json` (machine-readable, with `file:line`
evidence for every claim in this table).

Decision context: the project is leaving wasm. Node cores become plain Rust crates linked into
the host and self-registering via `inventory`. Native code can call `std::fs`, `std::process` and
sockets directly, so the old capability vocabulary (`xiranite.operation.*`, `xiranite.scheduler.*`,
`xiranite.path_token.resolve`, the retired `xiranite.fs.*` family) is no longer the question. The
question is **which policy the host still has to own**: which roots are granted, which external
binaries are allowlisted, whether network is allowed.

## Scope and method

* Retained set is `docs/xiranite-target-node-manifest.json` → `disposition: "retain-rewrite"` (41 nodes).
* Read `src/core.ts` + `src/platform.ts` **and the modules those import** (e.g. `coveru/src/zip-file-reader.ts`,
  `classf/src/blacklist.ts`, `findz/src/worker-client.ts`). `cli.ts` / `Tui.tsx` / `help.ts` / `interaction.ts` excluded by design.
* The authoritative capability surface is each node's `*Runtime` interface in `core.ts`: that object is
  the only thing core code can call. A helper sitting in `platform.ts` that is not a runtime member is
  host-side dead weight as far as the node core is concerned.
* `fileIo` = most demanding class actually performed, precedence `positionalRead > recursiveEnumeration >
  contentReadWrite > singleDirList > none`. `fileIoAll` in the JSON records every class that applies.
* Every crate named here was fetched from the crates.io API on 2026-10-05; `name@version (updated)`.

## Drift found before the table

* **Node list is clean.** All 41 `retain-rewrite` ids have a directory; the 6 `removed` + 1 `drop-to-standalone`
  ids have none; no unlisted directory exists. `xiranite.build.toml` `[nodes].disabled = ["clipm","kisaki","lata"]`
  matches the 3 `hold-unmigrated` entries exactly. All three legs of `bun run audit:target-node-manifest` agree.
  Only stray entry: `packages/nodes/.DS_Store`.
* **AGENTS.md claim not backed by code:** "trename 的中译英词典是 SQLite/FTS 文件" — zero matches for
  `sqlite`/`FTS`/`dictionary`/`opencc` anywhere under `packages/nodes/trename`. trename has no dictionary today,
  so the ADR-0071 "can SQLite live in the plugin" spike is moot for it; as native code the question dissolves anyway.
* **AGENTS.md claim confirmed:** "smartzip 读 ZIP 尾 32 MiB" is real and already positional —
  `smartzip/src/platform.ts:270-273` reads an 8-byte signature at offset 0 then a tail of up to 32 MiB at
  `info.size - tailSize`. "coveru 取解压条目" confirmed at `coveru/src/zip-file-reader.ts:34`.
* **Not in AGENTS.md:** `lorat` is a third positional reader — first 1 MiB at offset 0 **plus last 1 MiB** at
  `info.size - chunkSize` for its sampling hash (`lorat/src/platform.ts:149-159`).
* **False positives corrected** (they would otherwise have inflated the table): `repacku`'s "thumbnail" is an
  extension bucket list (`repacku/src/core.ts:136-141`); `nameu:248` / `samea:76-77` / `rawfilter`'s "trash" are filename
  tokens or a literal `trash/` subfolder (`rawfilter/src/core.ts:381`), not the recycle bin; `kavvka` is a keyword
  folder scanner (`kavvka/src/core.ts:147-210`), not a duplicate detector; `gifu/src/core.ts:197 recursive: true`
  is an input default, not an `fs` walk.
* **The single biggest structural finding:** 23 of 41 nodes define a byte-identical `readClipboardText()`
  block in `platform.ts` (powershell.exe `Get-Clipboard` / `pbpaste` / `wl-paste` / `xclip` / `xsel`), but **exactly one**
  of them reaches it from `core.ts` — `classf`, whose runtime member `readClipboardPaths` (`classf/src/core.ts:53`) is
  genuinely called at `classf/src/core.ts:87`. The other 22 are consumed only from `cli.ts`
  (e.g. `crashu/src/cli.ts:31,440`). For 22 of 41 nodes clipboard is **not** a node-core capability.

## Table (41 retain-rewrite nodes)

| id | fileIo | spawn (plugin surface) | net | osNative | heavy codec/image | blockers |
|---|---|---|---|---|---|---|
| audiov | none | ffmpeg, where/which | – | – | video/audio (via ffmpeg) | – |
| bandia | contentReadWrite | Bandizip, Everything.exe, where/which | – | recycleBin (trash defaults ON) | archive (via Bandizip) | – |
| bitv | recursiveEnumeration | ffprobe, where/which | – | – | video metadata (via ffprobe) | – |
| classf | singleDirList | via clipboard member today | – | **clipboard** (core-called) | Chinese t2s conversion (in-proc) | – |
| classq | singleDirList | – | – | – | – | – |
| cleanf | recursiveEnumeration | – | – | recycleBin | – | – |
| comfygure | contentReadWrite | – | **yes** HTTP+WebSocket → ComfyUI | – | – | – |
| coveru | **positionalRead** | – | – | – | archive decode **in-process** (zip.js) | – |
| crashu | contentReadWrite | – | – | – | – | – |
| dissolvef | contentReadWrite | – | – | – | – | – |
| encodb | recursiveEnumeration | – | – | – | charset detect+transcode **in-process** | – |
| enginev | contentReadWrite | – | – | recycleBin | – | – |
| envuconfig | recursiveEnumeration | – | – | – | – | – |
| **findz** | none (in TS) | – (FFI) | – | **fsWatch + sqlite** | archive members + image analysis | **yes** |
| formatv | contentReadWrite | – | – | – | – | – |
| gifu | contentReadWrite | 7z, ffmpeg, ffprobe, where/which | – | – | image+video+archive (all via CLI) | – |
| jellypot | contentReadWrite | PotPlayer, browser, cmd.exe, regedit.exe | – | registry (via `regedit /s`) | – | – |
| kavvka | recursiveEnumeration | – | – | – | – | – |
| linedup | **none** (zero imports) | – | – | – | – | – |
| linku | contentReadWrite | – | – | – (symlink/junction) | – | – |
| logx | contentReadWrite | – | – | – | – | – |
| lorat | **positionalRead** | – | – | – | – (sampling sha1) | – |
| marku | contentReadWrite | – | – | – | markdown AST + diff **in-process** | – |
| migratef | recursiveEnumeration | – | – | – | – | – |
| movea | singleDirList | – | – | – | – | – |
| mvz | none | 7z, where/which | – | – | archive (via 7z) | – |
| nameu | singleDirList | – | – | – | – | – |
| owithu | contentReadWrite | reg.exe | – | **registry + shellIntegration** | – | – |
| rawfilter | contentReadWrite | – | – | – (symlink + `.url`) | – | – |
| recycleu | none | powershell.exe | – | recycleBin | – | – |
| repacku | recursiveEnumeration | 7z, powershell.exe, where/which | – | – | archive (via CLI) | – |
| samea | singleDirList | – | – | – | – | – |
| seriex | contentReadWrite | – | – | – | – | – |
| sleept | none | powershell.exe, rundll32.exe, shutdown, osascript, systemctl | – | – (power state) | – | – |
| smartzip | **positionalRead** | 7z, **7zFM.exe** (GUI), where/which | – | recycleBin | archive + **charset detect** | – |
| snf | singleDirList | – | – | – | – | – |
| soundw | none | SoundSwitch.CLI.exe, where/which | – | – (tray-app control) | GB18030 decode **in-process** | – |
| synct | singleDirList | – | – | – | – | – |
| timeu | contentReadWrite | – | – | – | – | – |
| transq | recursiveEnumeration | – | – | – | – | – |
| trename | contentReadWrite | – | – | – | – | – |

## Rollup

**fileIo primary class (41 nodes)**

| class | nodes | count |
|---|---|---|
| `none` | audiov, findz, linedup, mvz, recycleu, sleept, soundw | 7 |
| `singleDirList` | classf, classq, movea, nameu, samea, snf, synct | 7 |
| `recursiveEnumeration` | bitv, cleanf, encodb, envuconfig, kavvka, migratef, repacku, transq | 8 |
| `contentReadWrite` | bandia, comfygure, crashu, dissolvef, enginev, formatv, gifu, jellypot, linku, logx, marku, owithu, rawfilter, seriex, timeu, trename | 16 |
| `positionalRead` | coveru, lorat, smartzip | 3 |

Counting every class a node touches (`fileIoAll`): 34 of 41 need a granted root (7 need none);
26 need directory listing, 25 need content read/write, 10 need recursive enumeration, 3 need positional reads.
3 nodes additionally need a **scratch/temp directory** (`bandia` `tempDir`, `gifu` `mkdtemp(tmpdir)`,
`smartzip` temp extraction).

**Spawn: 13 of 41 nodes.** `audiov, bandia, bitv, classf, gifu, jellypot, mvz, owithu, recycleu, repacku, sleept, smartzip, soundw`.

16 further nodes contain a spawn block that is **cli-only clipboard boilerplate** and therefore adds nothing to a
node's allowlist: `cleanf, crashu, dissolvef, encodb, enginev, formatv, kavvka, linedup, linku, lorat, marku, migratef,
movea, rawfilter, seriex, trename`. 6 nodes do both (`bandia, mvz, owithu, recycleu, repacku, sleept`).
Counting that boilerplate as node demand would have inflated the spawn column from 13 to 29.
(`classf` is the one node whose clipboard spawn is real, because `core.ts:87` calls it.)

Deduplicated program names today: **23** = 21 payload + 2 locators.

```
payload:  ffmpeg  ffprobe  7z  7zFM  Bandizip  Everything.exe  reg.exe  regedit.exe
          powershell.exe  cmd.exe  rundll32.exe  shutdown  osascript  systemctl
          SoundSwitch.CLI.exe  PotPlayer  <user browser path>
          pbpaste  wl-paste  xclip  xsel
locators: where.exe  which
```

After the native substitutions the crates above allow, the **irreducible allowlist is 9 names**:
`ffmpeg`, `ffprobe`, `7z`, `7zFM`, `Bandizip`, `Everything.exe`, `SoundSwitch.CLI(.exe)`, `PotPlayer`,
plus the user-configured browser path. `osascript`/`systemctl` reappear only if macOS/Linux become
delivery targets. Everything else collapses: `reg.exe`/`regedit.exe` → `winreg@0.56.0`; `powershell.exe`
(clipboard / `Clear-RecycleBin` / CPU+net counters / `Compress-Archive`) → `arboard@3.6.1`, `windows@0.62.2`,
`sysinfo@0.39.6`, `zip@8.6.0`; `pbpaste`/`wl-paste`/`xclip`/`xsel` → `arboard`; `where.exe`/`which` → `which@8.0.6`.

**Network: 1 of 41** — `comfygure` only. HTTP `GET /object_info`, `GET /history/<promptId>`,
`POST /prompt` plus the `@stable-canvas/comfyui-client` WebSocket, bound through a runtime `fetch`
member (`comfygure/src/contracts.ts:419`, `platform.ts:37`, `comfyui-client.ts:181`). `jellypot` is *not*
a network node: it assembles a Jellyfin URL string and hands it to a browser process (`jellypot/src/core.ts:159,167-168`).

**osNative (fixed vocabulary): 9 of 41 nodes.**

| kind | count | nodes |
|---|---|---|
| recycleBin | 5 | bandia, cleanf, enginev, recycleu, smartzip |
| registry | 2 | jellypot (via `regedit /s`), owithu (real hive writes) |
| clipboard | 1 | classf |
| fsWatch | 1 | findz |
| sqlite | 1 | findz |
| shellIntegration | 1 | owithu |
| thumbnail | **0** | none — `arcthumb`/`neoview` left the list; no retained node thumbnails |

Plus 2 nodes with an OS-shaped need the vocabulary does not name: `linku` and `rawfilter` create
**symlinks/junctions** (`linku/src/platform.ts:234-235` uses the Windows `junction` type; `rawfilter`
falls back to an `[InternetShortcut]` `.url` file at `platform.ts:90-100`) — a privilege question, not a capability.
`sleept` owns **power-state transitions** across three OS families (`platform.ts:79-93`).

**heavyCodecOrImage: 13 of 41.** Split matters: **6 in-process** (Rust must own these —
`coveru` zip decode, `encodeb` chardet+iconv, `marku` remark+diff, `smartzip` tail sniff + encoding,
`classf` opencc, `soundw` GB18030) and **6 delegated to a child process** (`audiov`, `bandia`, `bitv`,
`gifu`, `mvz`, `repacku`) — the latter are codec-free in-process, so they need no Rust codec dependency at all,
only an allowlisted binary. (`findz` is the 13th; its analysis lives in the Go core.)

**blockers: 1 of 41** — `findz`. Not because of the watcher alone. Its entire business implementation is a
Go library (`native/findz-go`, CGo `mattn/go-sqlite3`, `ffi.go`) loaded by FFI (`packages/findz-native/src/index.ts:107`)
and driven from a persistent Bun worker, with `@parcel/watcher` at `findz/src/findz-worker.ts:89` and a
surviving per-library index file at `native/findz-go/database.go:306`. `core.ts` is only a gateway client
(`core.ts:57` ignores its runtime argument; `platform.ts` returns the marker `{ runtime: "bun-worker" }`).
Turning it into a plain native crate means re-implementing scan, index, archive-member model, image analysis,
pause/resume/cancel and the watcher: a rewrite, not a port. Every other node is portable as-is.

## What the host must still gate

Deleting the capability layer leaves a small, boring policy surface — **and it is not a per-node surface.**

1. **Path grants, not file APIs.** 34 of 41 nodes need at least one authorized root and 3 need a scratch dir;
   `std::fs` covers 100% of their IO. The gate is a per-operation root allowlist (+ read-only vs read-write),
   nothing else. `positionalRead` is no longer a special case: `seek` + `read_exact` is ordinary native code,
   so coveru/lorat/smartzip need no distinct vocabulary at all.
2. **A binary allowlist of ~9 names, and it is a whitelist not a shell.** Bandizip, Everything.exe, 7zFM,
   PotPlayer and SoundSwitch.CLI are *third-party GUI apps that are the node's whole product* — they cannot be
   replaced by a crate, only registered and gated. The other 14 today's names are removable with the crate swaps
   listed above; leaving them as spawns would silently preserve the old "process containment" problem.
3. **Network is one node.** `comfygure` is the only reason the host needs a socket policy; gate it per node
   (and expect localhost:8188-style endpoints), do not give the other 40 a network surface.
4. **One recycle-bin service, one gate.** 5 nodes want trash-with-restore; today that is `@xiranite/czkawka-native`
   (`packages/file-operations/src/platform.ts:7-11`). Keep it as a single host service (`trash@5.2.9` or the
   existing fork) rather than five code paths, and keep restore/undo capability discovery with it.
5. **Registry + shell integration is one node** (`owithu`), plus `jellypot` writing `.reg` through `regedit.exe`.
   `winreg@0.56.0` removes both spawns and lets the host gate hive/scope (HKCU vs HKLM is the DangerGate line —
   `owithu/src/core.ts:6,79-81` expands HKCU/HKCR/HKLM × file/directory/background).
6. **Clipboard is one node at the core level** (`classf`). Dropping the 22 cli-side copies into
   `xiranite-cli-runtime`/`arboard` deletes 5 binaries from the allowlist and removes the largest source of
   copy-paste in `platform.ts`.
7. **`fsWatch` + persistent index exist for exactly one node** (`findz`) — it stays a host service with its own
   lifecycle, not a shared capability. Until it is decided, `notify@8.2.0` + `rusqlite@0.40.2` is the honest target.
8. **DangerGate sites are enumerable now**: `bandia` trashes by default (`core.ts:253 trash: input.useTrash ?? true`),
   `enginev` has an explicit `permanent` escape (`core.ts:436`), `cleanf` bulk-deletes (`core.ts:304`),
   `smartzip` deletes sources incl. after password extraction (`platform.ts:175-177`), `recycleu` empties the
   whole bin per drive, `sleept` shuts the machine down, `owithu` writes HKLM. Those seven are the gates; the
   remaining 34 nodes' worst case is a rename inside a granted root.

Net: **40 of 41 nodes become plain crates with no capability surface** — file IO under granted roots, plus for
13 of them a registered command name. The remaining policy surface is path grants, one ~9-entry binary
allowlist, one network opt-in, and one shared recycle-bin/registry/clipboard service each.

## Not verified / open

* No maintained Rust ComfyUI client found; `comfygure` must hand-roll `/object_info`, `/prompt`,
  `/history` and the WebSocket over `reqwest` + `tokio-tungstenite`.
* `everything@0.1.1` (2025-12-26) is a single-release crate; `bandia`'s Everything integration is unproven there —
  treat as `detached spawn of Everything.exe` until spiked.
* `sevenz-rust@0.6.1` last released 2024-07-17; `opencc@0.3.0` last released 2018-01-31 (and `lunpinyin` does not
  exist on crates.io). The Chinese-conversion dependency for `classf`/`trename` is **unverified** and needs a decision.
* `lofty@0.25.4` and `image@0.25.10` are listed as optional in-process alternatives; nothing in `bitv`/`coveru`
  needs them today.
* `kisaki` (`hold-unmigrated`) still spawns `explorer.exe` (`kisaki/src/platform.ts:198`) and `clipm`/`lata` were not
  analysed — excluded by disposition, so re-run this survey if they return.
