import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { zipSync } from "fflate"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspaceRoot = resolve(packageRoot, "..", "..")
const outputRoot = join(workspaceRoot, "build", "wails", "native-assets")
const prebuiltRoot = join(packageRoot, "prebuilt", `${process.platform}-${process.arch}`)

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
console.log(`Prepared embedded native assets from ${prebuiltRoot}`)

async function refreshPrebuilt(): Promise<void> {
  if (!process.argv.includes("--no-build")) {
    const build = Bun.spawnSync([process.execPath, "run", "build:native"], { cwd: packageRoot, stdout: "inherit", stderr: "inherit" })
    if (!build.success) process.exit(build.exitCode)
  }
  const bindingName = `xiranite-czkawka.${process.platform}-${process.arch}.node`
  const filenames = process.platform === "win32" ? [bindingName, "dav1d.dll"] : [bindingName]
  const files = Object.fromEntries(await Promise.all(filenames.map(async (name) => [name, new Uint8Array(await readFile(join(packageRoot, "native", name)))])))
  const archive = zipSync(files, { level: 9 })
  const archiveName = `czkawka.${process.platform}-${process.arch}.zip`
  const binding = createRequire(import.meta.url)(join(packageRoot, "native", bindingName)) as { getCzkawkaInfo(): { apiVersion: number; sourceVersion: string } }
  const info = binding.getCzkawkaInfo()
  const nextManifest = {
    schemaVersion: 1,
    assets: [{ id: "czkawka", version: `${info.sourceVersion}-api${info.apiVersion}`, platform: process.platform, arch: process.arch, archive: archiveName, binding: bindingName, sha256: hash(archive), files: filenames.map((name) => ({ name, sha256: hash(files[name]!) })) }],
  }
  await rm(prebuiltRoot, { recursive: true, force: true })
  await mkdir(prebuiltRoot, { recursive: true })
  await writeFile(join(prebuiltRoot, archiveName), archive)
  await writeFile(join(prebuiltRoot, "manifest.json"), `${JSON.stringify(nextManifest, null, 2)}\n`)
  console.log(`Refreshed prebuilt native asset: ${prebuiltRoot} (${(archive.byteLength / 1024 / 1024).toFixed(2)} MiB)`)
}

function hash(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex") }
