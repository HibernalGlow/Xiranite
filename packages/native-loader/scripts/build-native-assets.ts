import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { zipSync } from "fflate"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspaceRoot = resolve(packageRoot, "..", "..")
const platformId = `${process.platform}-${process.arch}`
const artifactRoot = join(
  process.env.XIRANITE_NATIVE_ARTIFACT_ROOT?.trim() || join(workspaceRoot, "native", "artifacts"),
  platformId,
)
const prebuiltRoot = join(workspaceRoot, "native", "prebuilt", platformId)
const outputRoot = join(workspaceRoot, "build", "wails", "native-assets")

const bindings = [
  { id: "arcthumb", packageName: "arcthumb-native", filename: `xiranite-arcthumb.${platformId}.node`, dependencies: [] },
  { id: "czkawka", packageName: "czkawka-native", filename: `xiranite-czkawka.${platformId}.node`, dependencies: process.platform === "win32" ? ["dav1d.dll"] : [] },
  { id: "findz", packageName: "findz-native", filename: "findz.dll", dependencies: [] },
] as const

const refreshBindings = selectedRefreshBindings()
if (process.argv.includes("--refresh")) await refreshPrebuilt(refreshBindings ?? bindings, refreshBindings !== undefined)

const manifestBytes = await readFile(join(prebuiltRoot, "manifest.json"))
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
      const build = Bun.spawnSync([process.execPath, "run", "build:native"], { cwd: bindingPackage, stdout: "inherit", stderr: "inherit" })
      if (!build.success) process.exit(build.exitCode)
    }
  }

  if (process.platform === "win32") process.env.PATH = `${artifactRoot};${process.env.PATH ?? ""}`
  const assets = []
  const archives = new Map<string, Uint8Array>()
  for (const binding of selectedBindings) {
    const filenames = [binding.filename, ...binding.dependencies]
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
    const existingManifest = JSON.parse(await readFile(manifestPath, "utf8")) as { schemaVersion: number; assets: Array<{ id: string; platform: string; arch: string }> }
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

function hash(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}
