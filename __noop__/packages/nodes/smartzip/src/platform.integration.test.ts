import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, test } from "vitest"
import { runSmartZip } from "./core.js"
import { createNodeSmartZipRuntime } from "./platform.js"

const execFileAsync = promisify(execFile)
const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })))
})

describe("SmartZip nested archive integration", () => {
  test("extracts encrypted archives nested behind extensionless binary names", async () => {
    const runtime = createNodeSmartZipRuntime()
    const tools = await runtime.find7z()
    if (!tools) return

    const root = await mkdtemp(join(tmpdir(), "xiranite-smartzip-nested-"))
    cleanupPaths.push(root)
    const payload = join(root, "深层_日本語.txt")
    const innerZip = join(root, "inner.zip")
    const strangeData = join(root, "not-an-archive.data")
    const middleZip = join(root, "middle.zip")
    const middleBinary = join(root, "opaque-layer.bin")
    const wrapper = join(root, "ordinary-folder")
    const outerZip = join(root, "outer.zip")

    await writeFile(payload, "中文 / 日本語 / English", "utf8")
    await run7z(tools.cli, ["a", innerZip, payload, "-pnest-pass", "-mem=AES256", "-y", "-sccUTF-8"])
    await rename(innerZip, strangeData)
    await run7z(tools.cli, ["a", middleZip, strangeData, "-pnest-pass", "-mem=AES256", "-y", "-sccUTF-8"])
    await rm(strangeData)
    await rename(middleZip, middleBinary)
    await mkdir(wrapper)
    await rename(middleBinary, join(wrapper, "opaque-layer.bin"))
    await run7z(tools.cli, ["a", outerZip, wrapper, "-y", "-sccUTF-8"])
    await rm(wrapper, { recursive: true })
    await rm(payload)

    const result = await runSmartZip({
      action: "extract",
      path: outerZip,
      iniText: "[set]\nnesting=1\nnestingMuilt=1\npartSkip=1\n[password]\n1=nest-pass",
      dryRun: false,
    }, runtime)

    expect(result.success).toBe(true)
    expect(JSON.stringify(result)).not.toContain("nest-pass")
    const extracted = await findFile(root, "深层_日本語.txt")
    expect(extracted).toBeTruthy()
    expect(await readFile(extracted!, "utf8")).toBe("中文 / 日本語 / English")
  }, 30_000)

  test("scans a directory and extracts only the first encrypted 7z volume", async () => {
    const runtime = createNodeSmartZipRuntime()
    const tools = await runtime.find7z()
    if (!tools) return

    const root = await mkdtemp(join(tmpdir(), "xiranite-smartzip-volumes-"))
    cleanupPaths.push(root)
    const payload = join(root, "分卷_日本語.bin")
    const archive = join(root, "sample.7z")
    const expected = randomBytes(220_000)
    await writeFile(payload, expected)
    await run7z(tools.cli, ["a", archive, payload, "-v64k", "-pvolume-pass", "-mhe=on", "-y", "-sccUTF-8"])
    await rm(payload)
    await writeFile(`${archive}.001.par2`, "PAR2 fixture must be ignored", "utf8")

    const volumes = (await readdir(root)).filter((name) => /^sample\.7z\.\d+$/.test(name))
    expect(volumes.length).toBeGreaterThan(1)
    const result = await runSmartZip({
      action: "extract",
      path: root,
      iniText: "[set]\npartSkip=1\n[password]\n1=volume-pass",
      dryRun: false,
    }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.operations).toHaveLength(1)
    expect(result.data?.operations?.[0]?.sourcePath).toMatch(/sample\.7z\.001$/)
    expect(JSON.stringify(result)).not.toContain("volume-pass")
    const extracted = await findFile(root, "分卷_日本語.bin")
    expect(extracted).toBeTruthy()
    expect(await readFile(extracted!)).toEqual(expected)
  }, 30_000)

  test("reports a configured-password failure without exposing the password", async () => {
    const runtime = createNodeSmartZipRuntime()
    const tools = await runtime.find7z()
    if (!tools) return

    const root = await mkdtemp(join(tmpdir(), "xiranite-smartzip-password-error-"))
    cleanupPaths.push(root)
    const payload = join(root, "payload.txt")
    const archive = join(root, "locked.7z")
    await writeFile(payload, "locked", "utf8")
    await run7z(tools.cli, ["a", archive, payload, "-pcorrect-secret", "-mhe=on", "-y", "-sccUTF-8"])

    const result = await runSmartZip({ action: "extract", path: archive, passwords: ["wrong-secret"], dryRun: false }, runtime)

    expect(result.success).toBe(false)
    expect(result.data?.errors[0]).toMatch(/could not be unlocked.*1 configured password/i)
    expect(JSON.stringify(result)).not.toMatch(/correct-secret|wrong-secret/)
  }, 30_000)
})

async function run7z(command: string, args: string[]): Promise<void> {
  await execFileAsync(command, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
}

async function findFile(root: string, name: string): Promise<string | undefined> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isFile() && entry.name === name) return path
    if (entry.isDirectory()) {
      const nested = await findFile(path, name)
      if (nested) return nested
    }
  }
  return undefined
}
