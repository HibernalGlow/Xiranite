import { availableParallelism } from "node:os"
import type { XlchemyToolStatus } from "./core.js"
import { probeSlimgCffi } from "./slimg-cffi.js"

interface SlimgWorkerRequest { id: number; source: string; target: string; quality: number }
interface SlimgWorkerResponse { id: number; error?: string }
interface PendingConversion extends SlimgWorkerRequest {
  resolve: () => void
  reject: (error: Error) => void
}
interface PoolWorker {
  worker: Worker
  active?: PendingConversion
  idleTimer?: ReturnType<typeof setTimeout>
}

const IDLE_WORKER_TIMEOUT_MS = 10_000

export function probeSlimg(): Promise<XlchemyToolStatus> {
  return probeSlimgCffi()
}

class SlimgWorkerPool {
  private readonly queue: PendingConversion[] = []
  private readonly workers: PoolWorker[] = []
  private sequence = 0

  constructor(private readonly maximumWorkers = Math.max(1, availableParallelism())) {}

  convert(source: string, target: string, quality: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({ id: ++this.sequence, source, target, quality, resolve, reject })
      this.dispatch()
    })
  }

  private dispatch() {
    while (this.queue.length) {
      const slot = this.workers.find((item) => !item.active) ?? this.createWorker()
      if (!slot) return
      if (slot.idleTimer) clearTimeout(slot.idleTimer)
      slot.idleTimer = undefined
      const request = this.queue.shift()!
      slot.active = request
      slot.worker.postMessage({ id: request.id, source: request.source, target: request.target, quality: request.quality } satisfies SlimgWorkerRequest)
    }
  }

  private createWorker(): PoolWorker | undefined {
    if (this.workers.length >= this.maximumWorkers) return undefined
    const extension = import.meta.url.endsWith(".ts") ? "ts" : "js"
    const worker = new Worker(new URL(`./slimg-worker.${extension}`, import.meta.url).href, { name: `xlchemy-slimg-${this.workers.length + 1}` })
    ;(worker as Worker & { unref?: () => void }).unref?.()
    const slot: PoolWorker = { worker }
    worker.onmessage = (event: MessageEvent<SlimgWorkerResponse>) => {
      const active = slot.active
      if (!active || event.data.id !== active.id) return
      slot.active = undefined
      if (event.data.error) active.reject(new Error(event.data.error))
      else active.resolve()
      this.dispatch()
      if (!slot.active) slot.idleTimer = setTimeout(() => this.retireWorker(slot), IDLE_WORKER_TIMEOUT_MS)
    }
    worker.onerror = (event) => {
      const active = slot.active
      slot.active = undefined
      this.retireWorker(slot)
      active?.reject(new Error(event.message || "slimg worker failed."))
      this.dispatch()
    }
    this.workers.push(slot)
    return slot
  }

  private retireWorker(slot: PoolWorker) {
    if (slot.active) return
    if (slot.idleTimer) clearTimeout(slot.idleTimer)
    const index = this.workers.indexOf(slot)
    if (index >= 0) this.workers.splice(index, 1)
    slot.worker.terminate()
  }
}

const workerPool = new SlimgWorkerPool()
export const convertWithSlimg = (source: string, target: string, quality: number) => workerPool.convert(source, target, quality)
