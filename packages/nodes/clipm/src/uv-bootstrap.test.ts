import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { resolveClipmUvCommand, type ClipmUvArtifact } from "./uv-bootstrap.js"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("resolveClipmUvCommand", () => {
  test("prefers an existing PATH command without touching the runtime", async () => {
    const commandAvailable = vi.fn(async (command: string) => command === "uv")
    const download = vi.fn()
    const extract = vi.fn()
    await expect(resolveClipmUvCommand({ runtimeRoot: "D:/runtime" }, {
      commandAvailable,
      download,
      extract,
    })).resolves.toBe("uv")
    expect(download).not.toHaveBeenCalled()
    expect(extract).not.toHaveBeenCalled()
  })

  test("downloads and verifies the pinned fallback under runtime_root tools", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "clipm-uv-bootstrap-"))
    temporaryRoots.push(runtimeRoot)
    const archive = Buffer.from("verified archive")
    const executable = Buffer.from("verified executable")
    const artifact: ClipmUvArtifact = {
      version: "test",
      archiveUrl: "https://example.invalid/uv.zip",
      archiveSha256: digest(archive),
      executableSha256: digest(executable),
    }
    const toolsRoot = join(runtimeRoot, "tools", "uv-test")
    await mkdir(toolsRoot, { recursive: true })
    await writeFile(join(toolsRoot, "uv-test-windows-x64.zip"), "stale archive")
    const commandAvailable = vi.fn(async (command: string) => command !== "uv")
    const download = vi.fn(async () => archive)
    const extract = vi.fn(async (_archivePath: string, destination: string) => {
      await writeFile(join(destination, "uv.exe"), executable)
    })

    const command = await resolveClipmUvCommand({
      runtimeRoot,
      platform: "win32",
      arch: "x64",
      artifact,
    }, { commandAvailable, download, extract })

    expect(command).toBe(join(runtimeRoot, "tools", "uv-test", "uv.exe"))
    expect(await readFile(join(runtimeRoot, "tools", "uv-test", "uv-test-windows-x64.zip"))).toEqual(archive)
    expect(commandAvailable).toHaveBeenCalledWith(command)
  })

  test("rejects a fallback archive with the wrong digest", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "clipm-uv-bootstrap-invalid-"))
    temporaryRoots.push(runtimeRoot)
    await expect(resolveClipmUvCommand({
      runtimeRoot,
      platform: "win32",
      arch: "x64",
      artifact: {
        version: "invalid",
        archiveUrl: "https://example.invalid/uv.zip",
        archiveSha256: digest(Buffer.from("expected")),
        executableSha256: digest(Buffer.from("uv")),
      },
    }, {
      commandAvailable: async () => false,
      download: async () => Buffer.from("tampered"),
      extract: vi.fn(),
    })).rejects.toThrow("SHA-256")
  })
})

function digest(payload: Uint8Array): string {
  return createHash("sha256").update(payload).digest("hex")
}
