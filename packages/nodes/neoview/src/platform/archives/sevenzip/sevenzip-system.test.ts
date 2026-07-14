import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterAll, describe, expect, it } from "vitest"

import { resolveSevenZipExecutable } from "./SevenZipExecutable.js"
import { parseSevenZipSlt } from "./sevenzip-slt.js"

const execFileAsync = promisify(execFile)
const executable = await resolveSevenZipExecutable().catch(() => undefined)
const cleanupDirectories: string[] = []

afterAll(async () => {
  await Promise.all(cleanupDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("system 7-Zip integration", () => {
  it.skipIf(!executable)("[neoview.sevenzip.system-index] parses a real non-solid technical listing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-7z-"))
    cleanupDirectories.push(directory)
    await mkdir(join(directory, "pages"))
    await mkdir(join(directory, "empty"))
    await writeFile(join(directory, "pages", "001.jpg"), Uint8Array.of(1, 2, 3, 4, 5))
    await writeFile(join(directory, "pages", "002.jpg"), Uint8Array.of(6, 7, 8))
    const archivePath = join(directory, "fixture.7z")
    await run(["a", "-t7z", "-mx=1", "-ms=off", "-bd", "-bb0", "--", archivePath, "pages", "empty"], directory)
    const output = await run(["l", "-slt", "-sccUTF-8", "--", archivePath], directory)
    const index = parseSevenZipSlt(output)

    expect(index.archiveType).toBe("7z")
    expect(index.solid).toBe(false)
    expect(index.entries.map((entry) => [entry.path, entry.kind, entry.uncompressedSize])).toEqual([
      ["empty", "directory", 0],
      ["pages", "directory", 0],
      ["pages/001.jpg", "file", 5],
      ["pages/002.jpg", "file", 3],
    ])
  })
})

async function run(args: string[], cwd: string): Promise<string> {
  const result = await execFileAsync(executable!.path, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  })
  return result.stdout
}
