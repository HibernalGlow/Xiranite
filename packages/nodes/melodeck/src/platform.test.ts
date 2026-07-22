import { createServer, type Socket } from "node:net"
import { describe, expect, it } from "vitest"
import type { MelodeckStatus } from "./core.js"
import { observeMelodeck } from "./platform.js"

describe("Melodeck mpv observer", () => {
  it("streams property changes over one persistent IPC connection", async () => {
    const ipc = process.platform === "win32"
      ? `\\\\.\\pipe\\xiranite-melodeck-test-${process.pid}-${Date.now()}`
      : `/tmp/xiranite-melodeck-test-${process.pid}-${Date.now()}.sock`
    let client: Socket | undefined
    const server = createServer((socket) => {
      client = socket
      socket.once("data", () => {
        socket.write(`${JSON.stringify({ event: "property-change", name: "media-title", data: "Observer Track" })}\n`)
        socket.write(`${JSON.stringify({ event: "property-change", name: "pause", data: true })}\n`)
        socket.write(`${JSON.stringify({ event: "property-change", name: "duration", data: 120 })}\n`)
        socket.write(`${JSON.stringify({ event: "property-change", name: "time-pos", data: 12.5 })}\n`)
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(ipc, resolve)
    })

    let dispose: (() => void) | undefined
    try {
      const status = await new Promise<MelodeckStatus>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("observer test timed out")), 2_000)
        void observeMelodeck(ipc, (next) => {
          if (next.position !== 12.5) return
          clearTimeout(timeout)
          resolve(next)
        }, reject).then((stop) => { dispose = stop })
      })
      expect(status).toMatchObject({ running: true, paused: true, title: "Observer Track", duration: 120, position: 12.5 })
    } finally {
      dispose?.()
      client?.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
