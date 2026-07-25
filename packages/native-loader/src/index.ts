import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { unzipSync } from "fflate"

interface NativeAssetFile {
  name: string
  sha256: string
}

interface NativeAsset {
  id: string
  version: string
  platform: string
  arch: string
  archive: string
  sha256: string
  binding: string
  files: NativeAssetFile[]
}

interface NativeAssetManifest {
  schemaVersion: 1
  assets: NativeAsset[]
}

export interface NativeBindingOptions {
  id: string
  filename: string
  overrideEnv: string
  workspaceRoot: string
  env?: NodeJS.ProcessEnv
}

export function resolveNativeBindingPath(options: NativeBindingOptions): string {
  const env = options.env ?? process.env
  const override = env[options.overrideEnv]?.trim()
  if (override) return override

  const artifactRoot = env.XIRANITE_NATIVE_ARTIFACT_ROOT?.trim()
    || join(options.workspaceRoot, "native", "artifacts")
  const developmentPath = join(artifactRoot, `${process.platform}-${process.arch}`, options.filename)
  if (existsSync(developmentPath)) return developmentPath

  const embeddedRoot = env.XIRANITE_NATIVE_ASSET_ROOT?.trim()
  if (embeddedRoot) return extractEmbeddedNativeBinding(embeddedRoot, nativeCacheRoot(env), options.id)

  throw new Error(`Xiranite ${options.id} native binding was not found at ${developmentPath}, and no embedded native asset root was provided.`)
}

export function extractEmbeddedNativeBinding(assetRoot: string, cacheRoot: string, id: string): string {
  const manifestPath = join(assetRoot, "manifest.json")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as NativeAssetManifest
  if (manifest.schemaVersion !== 1) throw new Error(`Unsupported native asset manifest schema: ${manifest.schemaVersion}`)
  const asset = manifest.assets.find((candidate) => candidate.id === id && candidate.platform === process.platform && candidate.arch === process.arch)
  if (!asset) throw new Error(`No embedded ${id} native asset for ${process.platform}-${process.arch}.`)

  const archivePath = resolveInside(assetRoot, asset.archive)
  verifyHash(archivePath, asset.sha256, "native asset archive")
  const targetRoot = join(cacheRoot, safeSegment(asset.id), `${safeSegment(asset.version)}-${asset.sha256.slice(0, 12)}`)
  const bindingPath = resolveInside(targetRoot, asset.binding)
  if (asset.files.every((file) => validCachedFile(targetRoot, file))) return bindingPath

  const stagingRoot = `${targetRoot}.tmp-${process.pid}`
  rmSync(stagingRoot, { recursive: true, force: true })
  mkdirSync(stagingRoot, { recursive: true })
  const entries = unzipSync(new Uint8Array(readFileSync(archivePath)))
  for (const file of asset.files) {
    const entry = entries[file.name]
    if (!entry) throw new Error(`Embedded native archive is missing ${file.name}.`)
    const target = resolveInside(stagingRoot, file.name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, entry)
    verifyHash(target, file.sha256, file.name)
  }

  mkdirSync(dirname(targetRoot), { recursive: true })
  rmSync(targetRoot, { recursive: true, force: true })
  renameSync(stagingRoot, targetRoot)
  return bindingPath
}

export function prependNativeLibraryPath(bindingPath: string, env: NodeJS.ProcessEnv = process.env): void {
  if (process.platform !== "win32") return
  const nativeDirectory = dirname(bindingPath)
  const entries = (env.PATH ?? "").split(";")
  if (!entries.some((entry) => entry.toLocaleLowerCase("en-US") === nativeDirectory.toLocaleLowerCase("en-US"))) {
    env.PATH = `${nativeDirectory};${env.PATH ?? ""}`
  }
}

function nativeCacheRoot(env: NodeJS.ProcessEnv): string {
  const base = env.LOCALAPPDATA ?? env.XDG_CACHE_HOME ?? join(homedir(), ".cache")
  return join(base, "Xiranite", "native")
}

function validCachedFile(root: string, file: NativeAssetFile): boolean {
  try {
    verifyHash(resolveInside(root, file.name), file.sha256, file.name)
    return true
  } catch {
    return false
  }
}

function verifyHash(path: string, expected: string, label: string): void {
  if (!existsSync(path)) throw new Error(`${label} not found at ${path}.`)
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex")
  if (actual !== expected) throw new Error(`${label} SHA-256 mismatch.`)
}

function resolveInside(root: string, relative: string): string {
  if (basename(relative) !== relative) throw new Error(`Unsafe native asset path: ${relative}`)
  const target = resolve(root, relative)
  if (dirname(target) !== resolve(root)) throw new Error(`Unsafe native asset path: ${relative}`)
  return target
}

function safeSegment(value: string): string {
  const segment = value.replace(/[^a-zA-Z0-9._-]/g, "-")
  if (!segment || segment === "." || segment === "..") throw new Error(`Unsafe native asset identifier: ${value}`)
  return segment
}
