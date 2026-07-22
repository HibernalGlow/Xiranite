import { createServer } from "node:net"
import { afterEach, describe, expect, it } from "bun:test"

import { managedViteCacheDir, resolveManagedFrontendUrl } from "./dev-frontend-url"

const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

describe("resolveManagedFrontendUrl", () => {
  it("preserves an explicit frontend URL when its port is free", async () => {
    const port = await reservePort()
    await expect(resolveManagedFrontendUrl({
      FRONTEND_DEVSERVER_URL: `http://localhost:${port}/`,
      XIRANITE_FRONTEND_PORT: "5173",
    })).resolves.toBe(`http://localhost:${port}`)
  })

  it("rejects an explicit frontend URL whose port is already occupied", async () => {
    const port = await occupyPort()
    await expect(resolveManagedFrontendUrl({
      FRONTEND_DEVSERVER_URL: `http://127.0.0.1:${port}`,
    })).rejects.toThrow(`FRONTEND_DEVSERVER_URL port ${port} is already in use`)
  })

  it("advances past consecutive occupied ports", async () => {
    const occupiedPort = await occupyConsecutivePorts(2)
    const resolved = new URL(await resolveManagedFrontendUrl({
      XIRANITE_FRONTEND_PORT: String(occupiedPort),
    }))

    expect(Number(resolved.port)).toBeGreaterThan(occupiedPort + 1)
  })

  it("rejects an invalid preferred port", async () => {
    await expect(resolveManagedFrontendUrl({ XIRANITE_FRONTEND_PORT: "invalid" })).rejects.toThrow(
      "XIRANITE_FRONTEND_PORT",
    )
  })
})

describe("managedViteCacheDir", () => {
  it("is stable across managed frontend endpoints", () => {
    expect(managedViteCacheDir()).toMatch(/\.cache[\\/]vite[\\/]managed$/)
  })
})

async function occupyConsecutivePorts(count: number): Promise<number> {
  for (let basePort = 61_000; basePort <= 65_535 - count; basePort += count) {
    const attempt: ReturnType<typeof createServer>[] = []
    try {
      for (let offset = 0; offset < count; offset += 1) {
        const server = createServer()
        attempt.push(server)
        await listen(server, basePort + offset)
      }
      servers.push(...attempt)
      return basePort
    } catch {
      await Promise.all(attempt.map(close))
    }
  }
  throw new Error(`Could not reserve ${count} consecutive test ports.`)
}

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

async function reservePort(): Promise<number> {
  for (let port = 61_000; port <= 65_535; port += 1) {
    const server = createServer()
    try {
      await listen(server, port)
      await close(server)
      return port
    } catch {
      await close(server)
    }
  }
  throw new Error("Could not find a free test port.")
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
