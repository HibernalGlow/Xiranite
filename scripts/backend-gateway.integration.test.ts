import { mkdtemp, rename, rm, writeFile } from "node:fs/promises"
import { createServer as createNetServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"
import { createServer, type ViteDevServer } from "vite"

import { startIsolatedTestBackend, type IsolatedTestBackend } from "./test-backend"
import { backendGatewayPublicUrl } from "./backend-gateway"
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
    cleanup.push(async () => {
      gateway.httpServer?.closeAllConnections()
      await gateway.close()
    })
    const frontendOrigin = gateway.resolvedUrls!.local[0]!.replace(/\/$/, "")
    const publicBaseUrl = backendGatewayPublicUrl(frontendOrigin)
    const token = "stable-gateway-token"

    const first = await startIsolatedTestBackend({ token, publicBaseUrl })
    cleanup.push(() => first.close())
    await writeTarget(targetPath, first)

    const firstHealth = await fetch(`${publicBaseUrl}/health`).then((response) => response.json()) as { instanceId: string }
    expect(firstHealth.instanceId).toBeString()
    const deletions = await fetch(`${publicBaseUrl}/file-deletions?token=${token}`)
    expect(deletions.status).toBe(200)
    expect(await deletions.json()).toMatchObject({ items: [] })

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
    const healthDuringRestart = fetch(`${publicBaseUrl}/health`)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const second = await startIsolatedTestBackend({ token, publicBaseUrl })
    cleanup.push(() => second.close())
    await writeTarget(targetPath, second)
    const secondHealthResponse = await healthDuringRestart
    expect(secondHealthResponse.status).toBe(200)
    const secondHealth = await secondHealthResponse.json() as { instanceId: string }

    expect(secondHealth.instanceId).toBeString()
    expect(secondHealth.instanceId).not.toBe(firstHealth.instanceId)
    expect(new URL(publicBaseUrl).origin).toBe(new URL(frontendOrigin).origin)
    expect(new URL(publicBaseUrl).pathname).toBe("/_xiranite/backend")

    await writeFile(targetPath, `${JSON.stringify({ baseUrl: "ftp://127.0.0.1:1" })}\n`, "utf8")
    const invalidTarget = await fetch(`${publicBaseUrl}/health`)
    expect(invalidTarget.status).toBe(502)
    expect(await invalidTarget.text()).toContain("Protocol")
  }, 180_000)
})

async function startGateway(targetPath: string): Promise<ViteDevServer> {
  const port = await availablePort()
  const server = await createServer({
    root: dirname(targetPath),
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true },
    plugins: [backendGatewayPlugin(targetPath)],
    server: { host: "127.0.0.1", port, strictPort: true },
  })
  await server.listen()
  return server
}

async function availablePort(): Promise<number> {
  const server = createNetServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Failed to reserve a gateway test port.")
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

async function writeTarget(path: string, backend: IsolatedTestBackend): Promise<void> {
  const temporaryPath = `${path}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify({
    baseUrl: backend.backend.url,
    token: backend.backend.token,
  })}\n`, "utf8")
  await rename(temporaryPath, path)
}
