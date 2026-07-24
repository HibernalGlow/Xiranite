import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "bun:test"

import {
  backendGatewayTargetPath,
  isBackendGatewayPath,
  readBackendGatewayTarget,
  writeBackendGatewayTarget,
} from "./backend-gateway"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("backend gateway", () => {
  it("keeps backend routing separate from Vite and Wails asset paths", () => {
    expect(isBackendGatewayPath("/reader/s/1/page/2")).toBe(true)
    expect(isBackendGatewayPath("/workspace/snapshot")).toBe(true)
    expect(isBackendGatewayPath("/local-files")).toBe(true)
    expect(isBackendGatewayPath("/src/main.tsx")).toBe(false)
    expect(isBackendGatewayPath("/wails/runtime")).toBe(false)
    expect(isBackendGatewayPath("/assets/app.js")).toBe(false)
  })

  it("stores internal targets outside the public directory and validates reads", async () => {
    const path = backendGatewayTargetPath("http://127.0.0.1:5173")
    expect(path).toMatch(/\.cache[\\/]backend-gateway[\\/]target-5173\.json$/)

    const directory = await mkdtemp(join(tmpdir(), "xiranite-gateway-"))
    temporaryDirectories.push(directory)
    const targetPath = join(directory, "target.json")
    await Bun.write(targetPath, JSON.stringify({ baseUrl: "http://127.0.0.1:43123", token: "secret" }))
    await expect(readBackendGatewayTarget(targetPath)).resolves.toEqual({
      baseUrl: "http://127.0.0.1:43123",
      token: "secret",
    })
  })

  it("atomically replaces a managed target", async () => {
    const frontendUrl = `http://127.0.0.1:${62_000 + Math.floor(Math.random() * 1_000)}`
    await writeBackendGatewayTarget({ baseUrl: "http://127.0.0.1:43124", token: "first" }, frontendUrl)
    await writeBackendGatewayTarget({ baseUrl: "http://127.0.0.1:43125", token: "second" }, frontendUrl)
    const path = backendGatewayTargetPath(frontendUrl)
    await expect(readBackendGatewayTarget(path)).resolves.toEqual({
      baseUrl: "http://127.0.0.1:43125",
      token: "second",
    })
    await rm(path, { force: true })
  })
})
