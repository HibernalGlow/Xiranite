import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, test } from "vitest"
import { ClipmWorkerManager } from "./worker-manager.js"

const runtimeRoots: string[] = []
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const pythonEnvironmentRoot = process.env.XIRANITE_CLIPM_TEST_PYTHON_ENVIRONMENT_ROOT
  ?? join(packageRoot, "python", ".venv")

afterAll(async () => {
  for (const root of runtimeRoots) await rm(root, { recursive: true, force: true })
})

describe("ClipM MCP stdio", () => {
  test("returns health over the official stdio client and exits after the transient lease", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "xiranite-clipm-mcp-"))
    runtimeRoots.push(runtimeRoot)
    const stderr: string[] = []
    const manager = new ClipmWorkerManager({
      runtimeRoot,
      pythonEnvironmentRoot,
      device: "cpu",
      syncEnvironment: false,
      onStderr: (message) => stderr.push(message),
    })
    const status = await manager.health()
    expect(status).toMatchObject({ healthy: true, databaseOk: true, device: "cpu", modelAvailable: false })
    expect(status.runtimeRoot.toLowerCase()).toBe(runtimeRoot.toLowerCase())
    expect(manager.snapshot()).toMatchObject({ state: "stopped", leaseCount: 0, pid: null })
    expect(stderr.join("\n")).not.toContain("Traceback")
    await manager.dispose()
  }, 60_000)
})
