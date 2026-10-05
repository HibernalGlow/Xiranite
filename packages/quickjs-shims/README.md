# `@xiranite/quickjs-shims`

The `node:` surface a Xiranite node bundle may use when it runs inside the embedded QuickJS host.

The node business logic stays TypeScript (ADR-0074): `packages/nodes/<id>/src/core.ts` has **zero** `node:`
imports and never touches `./platform`, so a node's **core** closure is platform-free and bundles clean. The
`node:` builtins live in `platform.ts`, which the host re-points at these shims at **build time** —
`scripts/build-node-bundles.ts` runs esbuild `--alias` from the table in `src/surface.ts`, and injects
`src/index.ts` as the realm prelude that publishes the `process` / `Buffer` globals. Every machine-dependent
answer goes through the one global the host installs before a bundle is evaluated (ADR-0074 decision 2):

```js
globalThis.__xrh = {
  call(op, jsonArgs) -> jsonString,             // synchronous host operation
  callAsync(op, jsonArgs) -> Promise<string>,   // host settles it later; the engine pumps jobs
  now() -> "2023-11-14T22:13:20.000Z",          // host clock, one spelling
  platform: { platform, arch, sep, pathSep, cwd, env /* json string */ }
}
```

Errors are data (`QuickJsShimError { code, message, details? }`), never engine traps.

## Operations v1 (the closed list the host answers)

`fs.stat fs.list fs.readText fs.writeText fs.ensureDir fs.move fs.delete fs.mkdtemp fs.copy fs.appendText
fs.utimes fs.link fs.symlink fs.readlink fs.realpath fs.readBytes fs.writeBytes proc.exec clock.now
crypto.randomUUID crypto.randomBytes crypto.digest os.tmpdir os.homedir os.cpus service.invoke` — 26 names,
defined in `src/host.ts` (`OPERATIONS_V1`), mirrored in `crates/xiranite-quickjs-executor/src/host_calls.rs`, and
cross-checked by `bun run audit:quickjs-host-ops` (which now reports only `proc.spawn`/`proc.poll`: the host
answers them, and a realm `ChildProcess` still has no agreed stream/handle shape). **A member that needs an
operation outside this list is exported as a function that throws**
`new Error("quickjs-shim: <module>.<member> is not implemented")` — never silently omitted (esbuild's named-import
resolution would then fail the bundle build) and never faked with a divergent second implementation.

Bytes never ride the JSON envelope (ADR-0071). The realm bridge installs `__xrh.callBytes(op, jsonArgs)` and
`__xrh.sendBytes(op, jsonArgs, bytes)` (`shims.rs:101-128`), declared on `XiraniteHost` in `src/host.ts`, so:
`readFile`/`readFileSync` **without** an encoding answer a `Buffer` like Node's, a non-utf8 `encoding` decodes
those same bytes, and a `Buffer`/`Uint8Array` write — or `flag: "a"` — goes down `fs.writeBytes` with `append`.
`crypto.createHash`/`crypto.hash` buffer the input and ask `crypto.digest` once, so there is exactly one SHA
implementation (the host's `sha1`/`sha256`); an algorithm the host does not answer is refused **by name**, with
the list it does answer. Single-buffer ceiling is 8 MiB (`filesystem.rs:42`); an offset past EOF answers an
*empty* buffer while an absent document answers `null`, which both fs faces turn into `ENOENT`.

The answer shapes match the executor's `json!` keys exactly: `fs.stat -> { path, exists, isFile, isDirectory,
isSymlink, sizeBytes, mtimeMs, atimeMs, … }` (the widened fields are answered only under a grant — a seam-only run
answers `null` plus a `reason`), `fs.list -> { entries }`, `fs.readText -> { path, content }`,
`fs.copy -> { source, target, copied, recursive }`, `fs.mkdtemp -> { path, created }`,
`fs.writeBytes -> { path, written, byteLength, append }`, `fs.symlink -> { target, path, linked, type }`,
`crypto.digest -> { algorithm, hex, byteLength }`, `os.cpus -> { count, cpus }`.

## `spawn` is `stdio: "ignore"` only, and that is a measured choice

`proc.spawn` answers `{ handle, pid, program }`, and the host retains at most **4 MiB of transcript per stream** per
live child (`machine.rs:49`), served in **262 144-byte** `proc.poll` windows with a `truncated` flag
(`proc_operations.rs:41,175-189`). So `child_process.spawn` honours `stdio: "ignore"` — where Node's own contract
says `child.stdout` **is** `null`, which is why the handle object is not an approximation — and refuses a piped
`stdio` naming what it would take (a host-side capture to a file). Emulating Node's pipes on a capped window would
drop the tail silently, and a progress reader would compute a wrong number from missing bytes.

The call sites, measured: the only `spawn` in a retained node is `packages/nodes/bandia/src/platform.ts:153`
(`spawn(everything, [...], { detached: true, stdio: "ignore" }).unref()`), which never reads output. The single
`child.stdout.on("data")` reader in the tree is `packages/nodes/lata/src/platform.ts:51`, and `lata` is shelved and
unregistered (`audit:node-bundles` WARNs it). `spawnSync` is `proc.exec` in Node's result shape, where a non-zero
exit is a value rather than a throw.

One consequence to keep in view: `engine.rs:294` takes the allowlist from `descriptor.requirements.processes`, and
`docs/xiranite-target-node-manifest.json` carries no `programs` key at all — so **no realm run can be granted a
program today**, and every `proc.exec`/`proc.spawn` from a bundle is refused by the host. The realm probe asserts
that the refusal arrives from the host (`spawn-ignore-reaches-the-host-and-the-allowlist-decides`) rather than being
decided in JavaScript; nodes that shell out to 7-Zip/ffmpeg stay broken on that path until the manifest names the
programs it is supposed to be the single source of.

## What a host refusal looks like

Node's `err.code` is part of the contract the retained nodes' `platform.ts` files branch on, so a refusal the host
states for a condition Node names is translated in one place (`HOST_REFUSAL_ERRNOS` in `src/host.ts`):
"the destination already exists" → `EEXIST`, "the path is outside the authorized roots" → `EACCES`, with the shim's
own code kept in `details.shimCode`. Any other refusal keeps its message and a `quickjs-shim-*` code — an errno
invented for text this layer has not observed would be the fake answer the Plugin API contract forbids. Absence of
a document is `ENOENT`, built by `missingDocument` in both fs faces.

One host rule differs from Node and is pinned rather than smoothed over: **`fs.symlink` sends the stored target
text through the granted-roots check**, so `symlink("note.txt", link)` — legal in Node, where the string is only
stored — comes back refused. An absolute target inside the granted root works. `linku` builds relative links most
and will meet this; see `opFsSymlink` in `src/ops.ts` and the check
`symlink-relative-target-is-refused-by-the-grant(disclosed-divergence)` in `spikes/fs-ops-realm-probe/`.

## `path.join` is the host's join, not Node's

The granted filesystem in `crates/xiranite-core/src/filesystem.rs` builds the path strings a node's plan rows are
keyed on: `join_paths` (`:418-436`), `normalize_separators` (`:372-374`), `path_within` (`:389-410`). Operations
v1 pins no `path.*` operation, so there is no host call to route `join` through; instead `src/path.ts`
`joinPathsMatch` reproduces `join_paths` line for line (collapse `\`→`/`, trim the first part's trailing `/` and
later parts' both, keep a lone root, **do not** collapse `..`). `path.posix.join` / `path.win32.join` keep Node's
collapsing semantics for the rare node that wants an explicit platform path.

## Implemented vs unimplemented, per builtin

Source of truth: `src/surface.ts` `MODULE_SURFACES`. `memberState(module, member)` returns
`"implemented" | "unsupported" | "unknown"`. Below is the rendered table; every name in *both* lists is a real
named export of the module.

### `node:fs/promises`
- **Implemented** (v1 ops): `readFile` `writeFile` (text only; a binary payload or non-utf8 `encoding` throws
  `quickjs-shim-signature-unsupported`), `readText` `writeText`, `readdir`, `stat`, `lstat`, `mkdir` (→
  `fs.ensureDir`; `recursive:false` throws), `rm` (→ `fs.delete`), `unlink`, `rmdir` (→ `fs.delete`), `rename`
  (→ `fs.move`), `access` (F_OK via `fs.stat`).
- **Unimplemented → throws**: `open`/FileHandle, `appendFile`, `copyFile`, `cp`, `mkdtemp`, `link`, `symlink`,
  `readlink`, `realpath`, `utimes`, `chmod`, `chown`, `truncate`, `lutimes`, `statfs`, `writev`, `readv`, `glob`,
  `opendir`, `watch`, `watchFile`. Reason in every case: no matching operation in v1. The measured nodes that hit
  these are `mkdtemp` (temp scratch), `appendFile`/`copyFile`/`cp` (comfygure, linku, smartzip, migratef),
  `symlink`/`link` (linku), `utimes` (timeu).

### `node:fs` (sync family)
- **Implemented**: `constants`, `promises`, `readFileSync`, `writeFileSync`, `readdirSync`, `statSync`,
  `lstatSync`, `existsSync`, `mkdirSync`, `rmSync`, `unlinkSync`, `rmdirSync`, `renameSync`, `accessSync`.
- **Unimplemented → throws**: `appendFileSync`, `mkdtempSync`, `copyFileSync`, `cpSync`, `linkSync`, `symlinkSync`,
  `readlinkSync`, `realpathSync`, `utimesSync`, `chmodSync`, `chownSync`, `truncateSync`, `lutimesSync`,
  `statfsSync`, `openSync`/`closeSync`/`readSync`/`writeSync`, `createReadStream`/`createWriteStream`, `watch`,
  `watchFile`, `unwatchFile`.

### `node:path`
- **Implemented** (pure TS, sep/Windows-ness from the host): `join` (host rule above), `normalize`, `resolve`,
  `relative`, `dirname`, `basename`, `extname`, `isAbsolute`, `parse`, `format`, `sep`, `delimiter`, `win32`,
  `posix`, `toNamespacedPath`.
- **Unimplemented → throws**: `_makeLong` (needs the Windows `\\?\` namespace; the host's granted-root check
  replaces it).

### `node:child_process`
- **Implemented**: `execFile` (→ `proc.exec`; carries `customPromisifyArgs=["stdout","stderr"]` so
  `promisify(execFile)` resolves `{ stdout, stderr }`), `execFileSync`. `shell: true` and `encoding:"buffer"`
  throw (allowlist boundary / byte envelope).
- **Unimplemented → throws**: `spawn` (a live ChildProcess handle), `spawnSync`, `exec`/`execSync` (a shell string
  bypasses the allowlist), `fork`. Measured `spawn` users: bandia (Bandizip progress), jellypot (launcher), gifu,
  mvz.

### `node:os`
- **Implemented**: `platform`, `arch` (host), `tmpdir` (`os.tmpdir`), `tmpdirSync`, `EOL`, `lineEnding`,
  `getSeparator`, `version`, `devNull`.
- **Unimplemented → throws**: `homedir` (granted roots are the host's; a guessed home writes outside them),
  `cpus`/`availableParallelism` (a fabricated count changes concurrency), `hostname`, `totalmem`/`freemem`,
  `networkInterfaces`, `userInfo`, `uptime`, `loadavg`, `machine`, `release`, `getPriority`/`setPriority`.

### `node:util`
- **Implemented** (pure TS): `promisify` (with the `customPromisifyArgs` contract), `callbackify`, `inspect`
  (bounded, deterministic, **not** Node's — no colour/prototype/getters), `types`, `debuglog` (disabled no-op),
  `styleText` (inert), `deprecate`, `isDeepEqual`, `TextEncoder`/`TextDecoder` (forwarded to engine globals).
- **Unimplemented → throws**: `parseArgs` (argv parsing belongs to the CLI face, which keeps Node's own `util`).

### `node:crypto`
- **Implemented**: `randomUUID` (`crypto.randomUUID`), `randomBytes` (`crypto.randomBytes`, hex → Uint8Array).
- **Unimplemented → throws**: `createHash`/`hash` (a JS SHA here and Rust's `sha2` in the host would be two
  implementations of one contract — measured users comfygure, lorat), `createHmac`, `randomFill`/`randomFillSync`/
  `timingSafeEqual`, cipher/sign/kdf surface.

### `node:url`
- **Implemented** (pure TS on host facts): `pathToFileURL`, `fileURLToPath`, `getURL`/`getURLSearchParams` (forward
  to the engine's WHATWG globals), `domainToASCII`/`domainToUnicode`.
- **Unimplemented → throws**: legacy `parse`/`format`/`resolve`/`Url` (`URL` is the supported spelling).

### realm globals (not builtins)
- `process` (`src/process.ts`, installed by the prelude): `platform`, `arch`, `env`, `cwd()`, `argv`, `version`,
  `versions`, `nextTick`, `hrtime`, `features`. `exit`/`kill`/`abort`/`chdir` **throw** (the host owns the
  lifecycle), `pid`/`stdout`/`stdin`/`stderr`/`memoryUsage`/`availableMemory` are absent by design.
- `Buffer` (`src/buffer.ts`, installed by the prelude *and* aliased as a module): the implementation is npm
  `buffer@6.0.3` (`node-buffer`), re-exported whole — `from`/`alloc`/`allocUnsafe`/`concat`/`byteLength`/
  `isBuffer`/`isEncoding`, and `toString` for **utf8, latin1/binary, hex, base64, ascii, utf16le**. The hand port
  refused `ucs2`/`utf16le`; upstream does not need to. `gb18030` and friends still throw — nodes that need a real
  code page bundle `iconv-lite` (pure JS), which is where a code table belongs.

## Five modules are re-exports, not implementations

`stream.ts`, `assert.ts`, `events.ts`, `string-decoder.ts`, `buffer.ts` now carry no algorithm: the implementation
is npm's (`readable-stream@4.7.0`, `assert@2.1.0`, `events@3.3.0`, `string_decoder@1.3.0`, `buffer@6.0.3`), each
installed under a `node-` alias so esbuild's `--alias` for the Node spelling cannot point a shim file back at
itself. What stays in these files is the refusal list, the module-level helpers, and two measured gaps:

- **`buffer` must be an aliased specifier**, not only a realm global: `string_decoder` → `safe-buffer` does
  `require('buffer')`, and an unmapped specifier there would put a second, silently different `Buffer` into every
  bundle. `spikes/polyfill-realm-probe/` asserts `Buffer === globalThis.Buffer` inside the realm.
- **`events@3.3.0` predates Node's error-code refactor.** Measured side by side: the throw *types* are equal
  (`Error` for an unhandled `error`, `TypeError` for a non-function listener, `RangeError` for a negative
  max-listeners count), but only Node 26 attaches `ERR_UNHANDLED_ERROR` / `ERR_INVALID_ARG_TYPE` /
  `ERR_OUT_OF_RANGE`, and its message for an unhandled non-`Error` quotes the value where the port prints
  `Unhandled error. (undefined)`. Diagnostics only, and pinned per side in `events.test.ts` rather than squashed
  into one parity script.
- **The port has no `errorMonitor`, no `captureRejections`, no `getEventListeners`, no static
  `setMaxListeners`/`getMaxListeners`, and its `once` is the Promise form** (which is why it works in a realm;
  Node 16+'s async-iterator `on` still throws). Because `errorMonitor` needs routing inside `emit()` and the port
  has none, the symbol is *not exported* — exporting it would let a listener register under a symbol nothing
  consults. `surface.ts` records each of these under `events.unsupported`.
- **`string_decoder`'s `Uint8Array` gap is closed by an instance wrapper** in `string-decoder.ts`: the port hands
  the buffer to `buf.toString(encoding, offset)`, so a plain `Uint8Array` decoded to `"104,105"` where Node answers
  `"hi"`. A prototype patch is not enough — for single-byte encodings the port installs `simpleWrite` on the
  instance — so the constructor wraps whatever `write`/`end` it found. The normalising class comes from
  `safe-buffer`, the same module the decoder builds its `lastChar` with.

## Interface needed from the executor / host

Stated as operation signatures (the executor owns the Rust side; the shims consume them). Beyond operations v1,
the build already proved these are reachable by the retained nodes:

- `fs.mkdtemp(prefix) -> path` — 15+ platform closures create temp scratch dirs.
- `fs.copy(source, target, { recursive?, force? }) -> null` — `copyFile`/`cp` (comfygure, linku, smartzip).
- `fs.appendText(path, text) -> null` — `appendFile`.
- `fs.utimes(path, atimeMs, mtimeMs) -> null` — `timeu` restores file times.
- `fs.link` / `fs.symlink` / `fs.readlink` / `fs.realpath` — `linku` symlink trees.
- `fs.readBytes(path, { offset?, length? }) -> ArrayBuffer` and `fs.writeBytes(path, bytes, { append? })` — binary
  content, **not** base64-in-JSON (ADR-0071). Or host-handle `fs.open`/`fs.readRange`/`fs.closeHandle`.
- `fs.stat` should also answer `{ sizeBytes, mtimeMs, atimeMs }` — the current executor `execute(Stat)` returns
  only `{ path, exists, isFile, isDirectory }`, which drops the size/times that `synct`/`enginev`/`timeu` plan on.
- `crypto.digest(algorithm, bytes) -> { hex }` — `createHash` (comfygure, lorat), served by the host's sha2.
- `proc.spawn(program, args, { cwd }) -> handle` with a byte/event channel — the `spawn` progress readers.
- `os.homedir() -> path` and `os.cpus() -> [ … ]`.
- **Builtins beyond the eight** (`stream`/`events`/`assert`/`string_decoder`/`buffer`/`worker_threads`/`module`/
  `zlib`/`readline`, plus bare `process`) are shimmed now, and the measured state on 2026-10-05 is
  **`unresolvedExternals: []` on all 30 nodes × both sides** (`bun scripts/build-node-bundles.ts`, then
  `bun scripts/audit-node-bundles.ts`). That is a snapshot, not a property: `node:vm` is still unmapped, and if a
  bundled npm starts reaching one, the audit goes red (WARN, FAIL under `--strict`) instead of going green with an
  external the realm cannot resolve.

`findz` (a Go worker + resident SQLite) and `owithu` (the `registry-js` native `.node` addon, which esbuild cannot
bundle at all) stay structural blockers; their disposition is in `scripts/audit-node-bundles.ts`'s allowlist with
the reason.

## Files

- `src/host.ts` — the only `__xrh` caller: host accessors, `QuickJsShimError`, operations v1, bytes-over-JSON helpers.
- `src/ops.ts` — one wrapper per v1 operation, parameter/answer names pinned to the executor.
- `src/internal.ts` — `Stats`/`Dirent`, path coercion, and the `notImplemented` throw the modules export.
- `src/{path,util,os,crypto,url,child-process,fs-promises,fs,process}.ts` — one module per builtin/globals, hand
  written because the answer comes from `__xrh` or from Node-shaped arithmetic the host cannot serve per call.
- `src/{stream,assert,events,string-decoder,buffer}.ts` — thin re-exports of the npm implementations, plus the
  refusal lists (see "Five modules are re-exports").
- `src/constants.ts` — the internal table behind `fs.constants`. No `node:constants` boundary any more; the
  specifier measures zero consumers.
- `src/node-events.d.ts`, `src/node-string-decoder.d.ts`, `src/safe-buffer.d.ts`, `src/node-assert.d.ts`,
  `src/readable-stream.d.ts`, `src/brotli-decompress.d.ts` — the loose declarations the upstream packages do not
  ship, so the re-export lists compile.
- `src/surface.ts` — the audit/README data (`SHIMMED_BUILTINS`, `MODULE_SURFACES`, `CORE_FORBIDDEN_GLOBAL_PATTERNS`).
- `src/index.ts` — the realm prelude (installs `process`/`Buffer`), injected by the bundler.
- `spikes/polyfill-realm-probe/` — the realm-side evidence for the five re-exported modules: 28 checks run inside
  the embedded QuickJS host (`bun spikes/polyfill-realm-probe/build.ts && target/debug/quickjs-run
  spikes/polyfill-realm-probe/out/probe.js run - '{}' .`), including the one-`Buffer` identity check. Vitest alone
  cannot prove any of it, because under Vitest the alias table does not apply and `node:buffer` is Node's builtin.
