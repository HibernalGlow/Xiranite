import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { zipSync } from "fflate"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspaceRoot = resolve(packageRoot, "..", "..")
const platformId = `${process.platform}-${process.arch}`
const artifactRoot = join(workspaceRoot, "native", "artifacts", platformId)
const prebuiltRoot = join(workspaceRoot, "native", "prebuilt", platformId)
const outputRoot = join(workspaceRoot, "build", "wails", "native-assets")

const bindings = [
  { id: "arcthumb", packageName: "arcthumb-native", filename: `xiranite-arcthumb.${platformId}.node`, dependencies: [] },
  { id: "czkawka", packageName: "czkawka-native", filename: `xiranite-czkawka.${platformId}.node`, dependencies: process.platform === "win32" ? ["dav1d.dll"] : [] },
  // Temporarily disabled: XLchemy uses the system slimg v0.6 CLI because the
  // in-process Node-API batch path caused unacceptable Bun RSS peaks.
  // { id: "slimg", packageName: "slimg-native", filename: `xiranite-slimg.${platformId}.node`, dependencies: process.platform === "win32" ? ["dav1d.dll"] : [] },
] as const

if (process.argv.includes("--refresh")) await refreshPrebuilt()

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

async function refreshPrebuilt(): Promise<void> {
  if (!process.argv.includes("--no-build")) {
    for (const binding of bindings) {
      const bindingPackage = join(workspaceRoot, "packages", binding.packageName)
      const build = Bun.spawnSync([process.execPath, "run", "build:native"], { cwd: bindingPackage, stdout: "inherit", stderr: "inherit" })
      if (!build.success) process.exit(build.exitCode)
    }
  }

  if (process.platform === "win32") process.env.PATH = `${artifactRoot};${process.env.PATH ?? ""}`
  const assets = []
  const archives = new Map<string, Uint8Array>()
  for (const binding of bindings) {
    const filenames = [binding.filename, ...binding.dependencies]
    const files = Object.fromEntries(await Promise.all(filenames.map(async (name) => [name, new Uint8Array(await readFile(join(artifactRoot, name)))])))
    const archive = zipSync(files, { level: 9 })
    const archiveName = `${binding.id}.${platformId}.zip`
    const nativeBinding = createRequire(import.meta.url)(join(artifactRoot, binding.filename)) as Record<string, () => Record<string, unknown>>
    const info = nativeBinding[infoMethod(binding.id)]?.()
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

  await rm(prebuiltRoot, { recursive: true, force: true })
  await mkdir(prebuiltRoot, { recursive: true })
  for (const [archiveName, archive] of archives) await writeFile(join(prebuiltRoot, archiveName), archive)
  await writeFile(join(prebuiltRoot, "manifest.json"), `${JSON.stringify({ schemaVersion: 1, assets }, null, 2)}\n`)
  console.log(`Refreshed ${assets.length} native prebuilt asset(s): ${prebuiltRoot}`)
}

function infoMethod(id: string): string {
  if (id === "arcthumb") return "getArcThumbInfo"
  if (id === "czkawka") return "getCzkawkaInfo"
  return "getSlimgInfo"
}

function bindingVersion(id: string, info: Record<string, unknown>): string {
  const apiVersion = String(info.apiVersion ?? "unknown")
  const sourceVersion = id === "slimg" ? info.bindingVersion : info.sourceVersion
  return `${String(sourceVersion ?? "unknown")}-api${apiVersion}`
}

function hash(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}
