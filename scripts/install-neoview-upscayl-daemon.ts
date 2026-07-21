import { execFile } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { access, copyFile, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { promisify } from "node:util"

import { resolveManagedUpscaylExecutable } from "../packages/nodes/neoview/src/platform/super-resolution/ManagedSuperResolutionCliLocator.js"

const execFileAsync = promisify(execFile)
const sourceArgument = argument("--source")
const expectedHash = argument("--expected-sha256")?.toLowerCase()

if (!sourceArgument || !expectedHash) {
  throw new Error("Usage: bun run install:neoview-upscayl-daemon -- --source <path> --expected-sha256 <sha256>")
}
if (!/^[a-f0-9]{64}$/u.test(expectedHash)) throw new Error("--expected-sha256 must be a 64-character hexadecimal SHA-256 digest.")

const source = await realpath(sourceArgument)
const sourceHash = await sha256(source)
if (sourceHash !== expectedHash) throw new Error(`SHA-256 mismatch for ${source}: expected ${expectedHash}, received ${sourceHash}`)

const probe = await execFileAsync(source, ["--help"], {
  encoding: "utf8",
  timeout: 5_000,
  windowsHide: true,
  maxBuffer: 2 * 1024 * 1024,
}).catch((error: { stdout?: string; stderr?: string }) => ({ stdout: error.stdout ?? "", stderr: error.stderr ?? "" }))
const help = `${probe.stdout}\n${probe.stderr}`
if (!/(?:^|\s)(?:-d|--daemon)(?:\s|,|$)/imu.test(help)) {
  throw new Error(`${source} is not the daemon-capable Upscayl CLI expected by Xiranite.`)
}

const destination = await resolveManagedUpscaylExecutable()
const toolRoot = dirname(dirname(destination))
const currentDirectory = dirname(destination)
const stagingDirectory = join(toolRoot, `.install-${randomUUID()}`)
const backupDirectory = join(toolRoot, `.previous-${randomUUID()}`)
const stagedExecutable = join(stagingDirectory, basename(destination))
let movedCurrent = false

await mkdir(stagingDirectory, { recursive: true })
try {
  await copyFile(source, stagedExecutable)
  const installedHash = await sha256(stagedExecutable)
  if (installedHash !== expectedHash) throw new Error(`Copied executable failed SHA-256 verification: ${installedHash}`)
  const details = await stat(stagedExecutable)
  await writeFile(join(stagingDirectory, "install.json"), `${JSON.stringify({
    schemaVersion: 1,
    source,
    sha256: installedHash,
    bytes: details.size,
    installedAt: new Date().toISOString(),
    daemonSupported: true,
  }, null, 2)}\n`, "utf8")

  if (await exists(currentDirectory)) {
    await rename(currentDirectory, backupDirectory)
    movedCurrent = true
  }
  await rename(stagingDirectory, currentDirectory)
  if (movedCurrent) await rm(backupDirectory, { recursive: true, force: true })
} catch (error) {
  if (movedCurrent && !(await exists(currentDirectory))) await rename(backupDirectory, currentDirectory).catch(() => undefined)
  throw error
} finally {
  await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined)
}

process.stdout.write(`${JSON.stringify({ installed: true, executablePath: destination, sha256: expectedHash }, null, 2)}\n`)

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex")
}

async function exists(path: string): Promise<boolean> {
  return await access(path).then(() => true, () => false)
}
