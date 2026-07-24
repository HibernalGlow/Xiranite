import { mkdtemp, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"
import { createServer, type ViteDevServer } from "vite"

import { startIsolatedTestBackend, type IsolatedTestBackend } from "./test-backend"
import { backendGatewayPlugin } from "../vite.config"

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close().catch(() => undefined)
})

describe("Vite backend gateway integration", () => {
  it("keeps one public URL while switching isolated backends and proxying ranges", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "xiranite-gateway-state-"))
    cleanup.push(() => rm(stateDirectory, { recursive: true, force: true }))
    const targetPath = join(stateDirectory, "target.json")
    const gateway = await startGateway(targetPath)
    cleanup.push(() => gateway.close())
    const publicBaseUrl = gateway.resolvedUrls!.local[0]!.replace(/\/$/, "")
    const token = "stable-gateway-token"

    const first = await startIsolatedTestBackend({ token, publicBaseUrl })
    cleanup.push(() => first.close())
    await writeTarget(targetPath, first)

    const firstHealth = await fetch(`${publicBaseUrl}/health`).then((response) => response.json()) as { instanceId: string }
    expect(firstHealth.instanceId).toBeString()

    const mediaPath = join(first.dataDir, "range.bin")
    await writeFile(mediaPath, Buffer.from("0123456789"))
    const ranged = await fetch(`${publicBaseUrl}/local-files?path=${encodeURIComponent(mediaPath)}&token=${token}`, {
      headers: { range: "bytes=2-5" },
    })
    expect(ranged.status).toBe(206)
    expect(ranged.headers.get("content-range")).toBe("bytes 2-5/10")
    expect(ranged.headers.get("connection")).not.toBe("close")
    expect(await ranged.text()).toBe("2345")

    await first.close()
    expect(first.backend.server.listening).toBe(false)
    const second = await startIsolatedTestBackend({ token, publicBaseUrl })
    cleanup.push(() => second.close())
    await writeTarget(targetPath, second)
    const secondHealth = await fetch(`${publicBaseUrl}/health`).then((response) => response.json()) as { instanceId: string }

    expect(secondHealth.instanceId).toBeString()
    expect(secondHealth.instanceId).not.toBe(firstHealth.instanceId)
    expect(new URL(publicBaseUrl).origin).toBe(new URL(gateway.resolvedUrls!.local[0]!).origin)
  }, 180_000)
})

async function startGateway(targetPath: string): Promise<ViteDevServer> {
  const server = await createServer({
    configFile: false,
    logLevel: "silent",
    plugins: [backendGatewayPlugin(targetPath)],
    server: { host: "127.0.0.1", port: 0, strictPort: true },
  })
  await server.listen()
  return server
}

async function writeTarget(path: string, backend: IsolatedTestBackend): Promise<void> {
  const temporaryPath = `${path}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify({
    baseUrl: backend.backend.url,
    token: backend.backend.token,
  })}\n`, "utf8")
  await rename(temporaryPath, path)
}
