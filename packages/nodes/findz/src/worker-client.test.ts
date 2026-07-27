import { describe, expect, it, vi } from "vitest"
import { FindzWorkerClient } from "./worker-client.js"
import type { FindzWorkerRequest, FindzWorkerResponse } from "./worker-protocol.js"

describe("FindzWorkerClient", () => {
  it("settles a matching Worker response and ignores unrelated ids", async () => {
    const worker = new FakeWorker()
    const client = new FindzWorkerClient(worker as unknown as Worker)

    const request = client.call<{ libraryId: string }>("library.open", { root: "D:/library" })
    expect(worker.postMessage).toHaveBeenCalledWith({ id: 1, method: "library.open", params: { root: "D:/library" } })
    worker.emitMessage({ id: 99, ok: true, result: { libraryId: "ignored" } })
    worker.emitMessage({ id: 1, ok: true, result: { libraryId: "library-1" } })

    await expect(request).resolves.toEqual({ libraryId: "library-1" })
  })

  it("rejects every pending request when the Worker errors or is terminated", async () => {
    const worker = new FakeWorker()
    const client = new FindzWorkerClient(worker as unknown as Worker)
    const errored = client.call("api.info", {})
    worker.emitError("native core stopped")
    await expect(errored).rejects.toThrow("native core stopped")

    const terminated = client.call("api.info", {})
    client.terminate()
    await expect(terminated).rejects.toThrow("Findz worker was terminated.")
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })
})

class FakeWorker {
  readonly postMessage = vi.fn<(request: FindzWorkerRequest) => void>()
  readonly terminate = vi.fn<() => void>()
  private readonly listeners = new Map<string, Array<(event: never) => void>>()

  addEventListener(type: string, listener: (event: never) => void): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  emitMessage(response: FindzWorkerResponse): void {
    for (const listener of this.listeners.get("message") ?? []) listener({ data: response } as never)
  }

  emitError(message: string): void {
    for (const listener of this.listeners.get("error") ?? []) listener({ message } as never)
  }
}
