import type { FindzWorkerGateway, FindzWorkerMethod, FindzWorkerRequest, FindzWorkerResponse } from "./worker-protocol.js"

interface PendingRequest {
  resolve(value: unknown): void
  reject(reason: Error): void
}

export class FindzWorkerClient implements FindzWorkerGateway {
  private readonly pending = new Map<number, PendingRequest>()
  private nextId = 1

  constructor(private readonly worker = new Worker(new URL("./findz-worker.js", import.meta.url), { name: "xiranite-findz" })) {
    worker.addEventListener("message", (event: MessageEvent<FindzWorkerResponse>) => this.handleResponse(event.data))
    worker.addEventListener("error", (event) => this.failPending(new Error(event.message || "Findz worker failed.")))
  }

  call<T>(method: FindzWorkerMethod, params: unknown): Promise<T> {
    const id = this.nextId++
    const request: FindzWorkerRequest = { id, method, params }
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage(request)
    })
  }

  terminate(): void {
    this.worker.terminate()
    this.failPending(new Error("Findz worker was terminated."))
  }

  async shutdown(): Promise<void> {
    await this.call<void>("shutdown", {})
    this.terminate()
  }

  private handleResponse(response: FindzWorkerResponse): void {
    const pending = this.pending.get(response.id)
    if (!pending) return
    this.pending.delete(response.id)
    if (response.ok) pending.resolve(response.result)
    else pending.reject(new Error(response.error.message))
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}

let sharedWorker: FindzWorkerClient | undefined

export function getFindzWorkerClient(): FindzWorkerClient {
  sharedWorker ??= new FindzWorkerClient()
  return sharedWorker
}

export async function stopFindzWorker(): Promise<void> {
  await sharedWorker?.shutdown()
  sharedWorker = undefined
}
