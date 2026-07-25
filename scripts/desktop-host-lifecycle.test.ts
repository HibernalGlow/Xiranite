import { expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { stopDesktopHost } from "./desktop-host-lifecycle"

type DesktopHostProcess = NonNullable<Parameters<typeof stopDesktopHost>[0]>

test("requests a graceful desktop host exit before forcing the process tree", async () => {
  const shutdownPath = join(tmpdir(), `xiranite-desktop-${randomUUID()}.stop`)
  let resolveExit!: (code: number) => void
  const exited = new Promise<number>((resolve) => { resolveExit = resolve })
  const child = { exitCode: null, exited } as DesktopHostProcess
  let forced = false

  const stopping = stopDesktopHost(child, shutdownPath, {
    timeoutMs: 1_000,
    forceStop: async () => { forced = true },
  })
  for (let attempt = 0; attempt < 100 && !(await Bun.file(shutdownPath).exists()); attempt += 1) {
    await Bun.sleep(1)
  }
  expect(await Bun.file(shutdownPath).exists()).toBe(true)
  resolveExit(0)

  expect(await stopping).toBe("graceful")
  expect(forced).toBe(false)
  expect(await Bun.file(shutdownPath).exists()).toBe(false)
})

test("forces an unresponsive desktop host after the grace period", async () => {
  const shutdownPath = join(tmpdir(), `xiranite-desktop-${randomUUID()}.stop`)
  const child = { exitCode: null, exited: new Promise<number>(() => undefined) } as DesktopHostProcess
  let forced = false

  const result = await stopDesktopHost(child, shutdownPath, {
    timeoutMs: 1,
    forceStop: async () => { forced = true },
  })

  expect(result).toBe("forced")
  expect(forced).toBe(true)
  expect(await Bun.file(shutdownPath).exists()).toBe(false)
})
