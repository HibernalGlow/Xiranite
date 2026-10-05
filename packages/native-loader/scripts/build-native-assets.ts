import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { zipSync } from "fflate"
// The same three helpers the runtime loader uses (`src/index.ts:4`), so the build-time rule for "where a
// binding finds its sibling libraries" cannot drift from the rule that answers it at runtime.
import { nativeLibraryPathVariable, nativePlatformKey, prependPathEntry, sharedLibraryExtension } from "@xiranite/platform"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspaceRoot = resolve(packageRoot, "..", "..")
const platformId = nativePlatformKey()
const artifactRoot = join(
  process.env.XIRANITE_NATIVE_ARTIFACT_ROOT?.trim() || join(workspaceRoot, "native", "artifacts"),
  platformId,
)
const prebuiltRoot = join(workspaceRoot, "native", "prebuilt", platformId)
const outputRoot = join(workspaceRoot, "build", "wails", "native-assets")
// The findz core is a plain shared library, so its extension follows the host
// that built it: native/artifacts/<platformId>/findz.{dll,dylib,so}.
const findzLibraryExtension = sharedLibraryExtension().slice(1)

const bindings = [
  { id: "arcthumb", packageName: "arcthumb-native", filename: `xiranite-arcthumb.${platformId}.node`, dependencies: [] },
  { id: "czkawka", packageName: "czkawka-native", filename: `xiranite-czkawka.${platformId}.node`, dependencies: process.platform === "win32" ? ["dav1d.dll"] : [] },
  { id: "findz", packageName: "findz-native", filename: `findz.${findzLibraryExtension}`, dependencies: [] },
] as const

const refreshBindings = selectedRefreshBindings()
if (process.argv.includes("--refresh")) await refreshPrebuilt(refreshBindings ?? bindings, refreshBindings !== undefined)

const manifestPath = join(prebuiltRoot, "manifest.json")
let manifestBytes: Uint8Array
try {
  manifestBytes = new Uint8Array(await readFile(manifestPath))
} catch (error) {
  if (!isMissingFile(error)) throw error
  // Only Windows has a committed prebuilt store. A macOS or Linux host still
  // packages a manifest so the embedded-asset layout stays valid; the loader
  // then reports those native bindings as unavailable instead of the release
  // build failing outright. Run `bun run refresh:native-assets` to fill it in.
  console.warn(`[native-assets] No prebuilt store for ${platformId} at ${prebuiltRoot}; packaging zero native assets.`)
  manifestBytes = new TextEncoder().encode(`${JSON.stringify({ schemaVersion: 1, assets: [] }, null, 2)}\n`)
}
const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as { assets: Array<{ archive: string; sha256: string }> }
await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })
await writeFile(join(outputRoot, "manifest.json"), manifestBytes)
for (const asset of manifest.assets) {
  const source = join(prebuiltRoot, asset.archive)
  const archive = new Uint8Array(await readFile(source))
  if (hash(archive) !== asset.sha256) throw new Error(`Prebuilt native asset SHA-256 mismatch: ${source}`)
  await copyFile(source, join(outputRoot, asset.archive))
}
console.log(`Prepared ${manifest.assets.length} embedded native asset(s) from ${prebuiltRoot}`)

async function refreshPrebuilt(selectedBindings: readonly (typeof bindings)[number][], preserveExistingAssets: boolean): Promise<void> {
  if (!process.argv.includes("--no-build")) {
    for (const binding of selectedBindings) {
      const bindingPackage = join(workspaceRoot, "packages", binding.packageName)
      const build = spawnSync(process.execPath, ["run", "build:native"], { cwd: bindingPackage, stdio: "inherit" })
      if (build.status !== 0) process.exit(build.status ?? 1)
    }
  }

  // Seeded for every platform, not just Windows: a freshly built `.node` dlopens its sibling
  // (`libdav1d` on Windows, the findz `.dylib`/`.so` elsewhere), and the variable that makes it findable
  // is `PATH` / `DYLD_LIBRARY_PATH` / `LD_LIBRARY_PATH`. Before this, `--refresh` on macOS or Linux built
  // the bindings with no search path at all, so only the release gate ever exercised this step.
  const libraryVariable = nativeLibraryPathVariable()
  // `prependPathEntry(list, entry)`: the current value first, the directory to add second — the same
  // argument order `src/index.ts:89` uses at runtime.
  process.env[libraryVariable] = prependPathEntry(
    process.env[libraryVariable],
    artifactRoot,
  )
  const assets = []
  const archives = new Map<string, Uint8Array>()
  for (const binding of selectedBindings) {
    const bundled = await bundleMachineSpecificDependencies(join(artifactRoot, binding.filename), artifactRoot)
    const filenames = [binding.filename, ...binding.dependencies, ...bundled]
    const files = Object.fromEntries(await Promise.all(filenames.map(async (name) => [name, new Uint8Array(await readFile(join(artifactRoot, name)))])))
    const archive = zipSync(files, { level: 9 })
    const archiveName = `${binding.id}.${platformId}.zip`
    const info = binding.id === "findz"
      ? await getFindzNativeInfo(join(artifactRoot, binding.filename))
      : getNodeApiInfo(binding.id, join(artifactRoot, binding.filename))
    if (!info) throw new Error(`Native binding ${binding.id} did not expose its info method.`)
    const version = bindingVersion(binding.id, info)
    archives.set(archiveName, archive)
    assets.push({
      id: binding.id,
      version,
      platform: process.platform,
      arch: process.arch,
      archive: archiveName,
      binding: binding.filename,
      sha256: hash(archive),
      files: filenames.map((name) => ({ name, sha256: hash(files[name]!) })),
    })
  }

  if (preserveExistingAssets) {
    const manifestPath = join(prebuiltRoot, "manifest.json")
    // A platform store that does not exist yet starts empty, so bindings can be
    // refreshed one at a time on a host whose prebuilt directory is new.
    const existingManifest = JSON.parse(
      await readFile(manifestPath, "utf8").catch((error: unknown) => {
        if (isMissingFile(error)) return `{ "schemaVersion": 1, "assets": [] }`
        throw error
      }),
    ) as { schemaVersion: number; assets: Array<{ id: string; platform: string; arch: string }> }
    if (existingManifest.schemaVersion !== 1) throw new Error(`Unsupported native asset manifest schema: ${existingManifest.schemaVersion}`)
    const replacementByKey = new Map(assets.map((asset) => [`${asset.id}:${asset.platform}:${asset.arch}`, asset]))
    const existingKeys = new Set<string>()
    const mergedAssets = existingManifest.assets.map((asset) => {
      const key = `${asset.id}:${asset.platform}:${asset.arch}`
      existingKeys.add(key)
      return replacementByKey.get(key) ?? asset
    })
    for (const asset of assets) {
      const key = `${asset.id}:${asset.platform}:${asset.arch}`
      if (!existingKeys.has(key)) mergedAssets.push(asset)
    }
    await mkdir(prebuiltRoot, { recursive: true })
    for (const [archiveName, archive] of archives) await writeFile(join(prebuiltRoot, archiveName), archive)
    await writeFile(manifestPath, `${JSON.stringify({ schemaVersion: 1, assets: mergedAssets }, null, 2)}\n`)
    console.log(`Refreshed ${assets.length} native prebuilt asset(s) without replacing other assets: ${prebuiltRoot}`)
    return
  }

  await rm(prebuiltRoot, { recursive: true, force: true })
  await mkdir(prebuiltRoot, { recursive: true })
  for (const [archiveName, archive] of archives) await writeFile(join(prebuiltRoot, archiveName), archive)
  await writeFile(join(prebuiltRoot, "manifest.json"), `${JSON.stringify({ schemaVersion: 1, assets }, null, 2)}\n`)
  console.log(`Refreshed ${assets.length} native prebuilt asset(s): ${prebuiltRoot}`)
}

function selectedRefreshBindings(): readonly (typeof bindings)[number][] | undefined {
  const onlyIndex = process.argv.findIndex((argument) => argument === "--only" || argument.startsWith("--only="))
  if (onlyIndex === -1) return undefined
  if (!process.argv.includes("--refresh")) throw new Error("--only requires --refresh.")
  const value = process.argv[onlyIndex] === "--only"
    ? process.argv[onlyIndex + 1]
    : process.argv[onlyIndex]?.slice("--only=".length)
  if (!value || value.startsWith("--")) throw new Error("--only requires one or more comma-separated native asset ids.")
  const ids = new Set(value.split(",").map((id) => id.trim()).filter(Boolean))
  const selected = bindings.filter((binding) => ids.delete(binding.id))
  if (ids.size > 0) throw new Error(`Unknown native asset id(s): ${[...ids].join(", ")}.`)
  return selected
}

function infoMethod(id: string): string {
  if (id === "arcthumb") return "getArcThumbInfo"
  if (id === "czkawka") return "getCzkawkaInfo"
  throw new Error(`Unknown native binding: ${id}`)
}

function bindingVersion(id: string, info: Record<string, unknown>): string {
  if (id === "findz") return `${String(info.coreVersion ?? "unknown")}-abi${String(info.abiVersion ?? "unknown")}`
  const apiVersion = String(info.apiVersion ?? "unknown")
  return `${String(info.sourceVersion ?? "unknown")}-api${apiVersion}`
}

/**
 * Bundle the libraries a freshly built binding loads by a machine-specific absolute path.
 *
 * Measured on this host before writing this: `otool -l` on
 * `native/artifacts/darwin-arm64/xiranite-czkawka.darwin-arm64.node` lists
 * `/opt/homebrew/opt/dav1d/lib/libdav1d.7.dylib` under `LC_LOAD_DYLIB`, so a Mac without that exact
 * Homebrew install cannot dlopen the packaged asset at all. Windows already ships its dav1d beside the
 * binding (`dav1d.dll` in `bindings[].dependencies`); this is the same decision for the POSIX dylib
 * world, done as a rewrite so nothing has to be told where to look: the dependency becomes
 * `@rpath/<leaf>` and the binary gains `LC_RPATH = @loader_path`, which resolves inside the directory
 * the loader already unpacks the asset into (`src/index.ts:89`).
 *
 * `LC_ID_DYLIB` is deliberately not treated as a dependency — it is the file's *own* recorded name, and
 * these bindings still carry a pre-move path there (`/Users/glow/Projects/Xiranite/…`), harmlessly: the
 * copies load fine from an unrelated directory. Reading that line as a load command is how "the mac
 * artifacts are not relocatable" got asserted once already, so only the four load-dylib commands parse.
 *
 * Linux is not handled here on purpose. The equivalent needs `objdump -p` plus patchelf, and with no
 * Linux host to verify either one, shipping unverified rewrite code would be worse than the documented
 * gap.
 */
async function bundleMachineSpecificDependencies(bindingPath: string, artifactRoot: string): Promise<string[]> {
  if (process.platform !== "darwin") return []
  const dump = spawnSync("otool", ["-l", bindingPath], { encoding: "utf8" })
  if (dump.status !== 0) throw new Error(`otool -l failed for ${bindingPath}: ${dump.stderr.trim()}`)

  const bundled: string[] = []
  let addedRpath = false
  for (const dependency of parseOtoolLoadCommands(dump.stdout)) {
    if (isSystemLibrary(dependency)) continue
    const leaf = basename(dependency)
    if (!leaf) continue
    const target = join(artifactRoot, leaf)
    if (!existsSync(dependency)) {
      // Loud on purpose: a packaged asset that cannot load is worse than a failed refresh.
      console.warn(`[native-assets] ${basename(bindingPath)} requires ${dependency}, absent on this host; the packaged asset will not load here.`)
      continue
    }
    if (!addedRpath) {
      await runTool("install_name_tool", ["-add_rpath", "@loader_path", bindingPath])
      addedRpath = true
    }
    await runTool("install_name_tool", ["-change", dependency, `@rpath/${leaf}`, bindingPath])
    await copyFile(dependency, target)
    await runTool("codesign", ["--force", "--sign", "-", target])
    bundled.push(leaf)
    console.log(`[native-assets] Bundled ${leaf} beside ${basename(bindingPath)} (was ${dependency})`)
  }
  // Editing load commands invalidates the signature, so anything rewritten gets re-signed ad-hoc.
  if (bundled.length > 0) await runTool("codesign", ["--force", "--sign", "-", bindingPath])
  return bundled
}

/** Only the load commands that mean "I need this library at runtime" — never `LC_ID_DYLIB`. */
export function parseOtoolLoadCommands(dump: string): string[] {
  const wanted = new Set(["LC_LOAD_DYLIB", "LC_LOAD_WEAK_DYLIB", "LC_REEXPORT_DYLIB", "LC_UPWARD_DYLIB"])
  const names: string[] = []
  let pending = false
  for (const line of dump.split("\n")) {
    const cmd = /^\s*cmd (\S+)$/.exec(line)
    if (cmd !== null) {
      pending = wanted.has(cmd[1]!)
      continue
    }
    if (pending) {
      const name = /^\s*name (\S+)/.exec(line)
      if (name !== null) {
        names.push(name[1]!)
        pending = false
      }
    }
  }
  return names
}

/** `/usr/lib` and system frameworks exist on every Mac; anything else belongs to this machine. */
export function isSystemLibrary(path: string): boolean {
  return path.startsWith("/usr/lib/") || path.startsWith("/System/") || path.includes(".framework/")
}

async function runTool(program: string, args: string[]): Promise<void> {
  const result = spawnSync(program, args, { encoding: "utf8" })
  if (result.status !== 0) throw new Error(`${program} ${args.join(" ")} failed: ${result.stderr.trim()}`)
}

function getNodeApiInfo(id: string, bindingPath: string): Record<string, unknown> {
  const nativeBinding = createRequire(import.meta.url)(bindingPath) as Record<string, () => Record<string, unknown>>
  const info = nativeBinding[infoMethod(id)]?.()
  if (!info) throw new Error(`Native binding ${id} did not expose its info method.`)
  return info
}

async function getFindzNativeInfo(bindingPath: string): Promise<Record<string, unknown>> {
  const ffi = await import("bun:ffi") as unknown as {
    dlopen(path: string, symbols: Record<string, unknown>): {
      symbols: {
        findz_abi_version(): number
        findz_api_info(length: unknown): unknown
        findz_free(response: unknown): void
      }
      close(): void
    }
    ptr(value: BigUint64Array): unknown
    toArrayBuffer(pointer: unknown, byteOffset: number, length: number): ArrayBuffer
  }
  const library = ffi.dlopen(bindingPath, {
    findz_abi_version: { args: [], returns: "u32" },
    findz_api_info: { args: ["ptr"], returns: "ptr" },
    findz_free: { args: ["ptr"], returns: "void" },
  })
  try {
    if (library.symbols.findz_abi_version() !== 1) throw new Error(`Findz native core has an incompatible ABI at ${bindingPath}.`)
    const responseLength = new BigUint64Array(1)
    const responsePointer = library.symbols.findz_api_info(ffi.ptr(responseLength))
    if (!responsePointer) throw new Error("Findz native core did not return API info.")
    try {
      const length = Number(responseLength[0])
      if (!Number.isSafeInteger(length) || length <= 0) throw new Error("Findz native core returned an invalid API-info response length.")
      const response = JSON.parse(new TextDecoder().decode(ffi.toArrayBuffer(responsePointer, 0, length))) as { ok?: boolean; result?: Record<string, unknown> }
      if (!response.ok || !response.result) throw new Error(`Findz native core rejected API-info request: ${JSON.stringify(response)}`)
      return response.result
    } finally {
      library.symbols.findz_free(responsePointer)
    }
  } finally {
    library.close()
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT"
}

function hash(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}
