import { createServer } from "node:net"
import { afterEach, describe, expect, it } from "bun:test"

import { managedViteCacheDir, resolveManagedFrontendUrl } from "./dev-frontend-url"

const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

describe("resolveManagedFrontendUrl", () => {
  it("preserves an explicit frontend URL", async () => {
    await expect(resolveManagedFrontendUrl({
      FRONTEND_DEVSERVER_URL: "http://localhost:6123/",
      XIRANITE_FRONTEND_PORT: "5173",
    })).resolves.toBe("http://localhost:6123")
  })

  it("refuses to create a second managed server when the configured port is occupied", async () => {
    const occupiedPort = await occupyPort()
    await expect(resolveManagedFrontendUrl({
      XIRANITE_FRONTEND_PORT: String(occupiedPort),
    })).rejects.toThrow(`Frontend dev server port ${occupiedPort} is already in use`)
  })

  it("rejects an invalid preferred port", async () => {
    await expect(resolveManagedFrontendUrl({ XIRANITE_FRONTEND_PORT: "invalid" })).rejects.toThrow(
      "XIRANITE_FRONTEND_PORT",
    )
  })
})

describe("managedViteCacheDir", () => {
  it("isolates managed Vite caches by frontend endpoint", () => {
    expect(managedViteCacheDir("http://127.0.0.1:5173")).toMatch(/\.cache[\\/]vite[\\/]127\.0\.0\.1-5173$/)
    expect(managedViteCacheDir("http://127.0.0.1:5174")).toMatch(/\.cache[\\/]vite[\\/]127\.0\.0\.1-5174$/)
  })
})

async function occupyPort(): Promise<number> {
  for (let port = 61_000; port <= 65_535; port += 1) {
    const server = createServer()
    try {
      await listen(server, port)
      servers.push(server)
      return port
    } catch {
      await close(server)
    }
  }
  throw new Error("Could not reserve a test port.")
}

function listen(server: ReturnType<typeof createServer>, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen({ host: "127.0.0.1", port, exclusive: true }, resolve)
  })
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}
