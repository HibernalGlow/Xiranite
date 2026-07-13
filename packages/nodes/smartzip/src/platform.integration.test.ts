import { execFile } from "node:child_process"
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
