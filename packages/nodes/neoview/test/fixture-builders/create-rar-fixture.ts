import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export interface RarFixtureEntry {
  path: string
  bytes: Uint8Array
}

export interface RarFixtureOptions {
  entries: readonly RarFixtureEntry[]
  password: string
  format?: 4 | 5
  solid?: boolean
  encryptHeaders?: boolean
  name?: string
  executablePath?: string
}

export interface RarFixture {
  directory: string
  path: string
  cleanup(): Promise<void>
}

export async function resolveRarFixtureExecutable(): Promise<string | undefined> {
  if (process.env.XIRANITE_RAR_PATH?.trim()) return process.env.XIRANITE_RAR_PATH.trim()
  const locator = process.platform === "win32" ? "where.exe" : "which"
  return execFileAsync(locator, ["rar"], { windowsHide: true, encoding: "utf8" })
    .then(({ stdout }) => stdout.split(/\r?\n/u).map((value) => value.trim()).find(Boolean))
    .catch(() => undefined)
}

export async function createRarFixture(options: RarFixtureOptions): Promise<RarFixture> {
  const executablePath = options.executablePath ?? await resolveRarFixtureExecutable()
  if (!executablePath) throw new Error("RAR fixture executable was not found.")
  if (!options.entries.length) throw new Error("RAR fixture requires at least one entry.")
  const directory = await mkdtemp(join(tmpdir(), "xiranite-neoview-rar-"))
  const path = join(directory, options.name ?? "fixture.cbr")
  try {
    for (const entry of options.entries) {
      const entryPath = join(directory, ...entry.path.split("/"))
      await mkdir(dirname(entryPath), { recursive: true })
      await writeFile(entryPath, entry.bytes)
    }
    await execFileAsync(executablePath, [
      "a",
      "-idq",
      "-m1",
      `-ma${options.format ?? 5}`,
      options.solid ? "-s" : "-s-",
      `${options.encryptHeaders ? "-hp" : "-p"}${options.password}`,
      "--",
      path,
      ...options.entries.map((entry) => process.platform === "win32" ? entry.path.replaceAll("/", "\\") : entry.path),
    ], {
      cwd: directory,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    })
    return { directory, path, cleanup: () => rm(directory, { recursive: true, force: true }) }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}
