import { describe, expect, it, vi } from "vitest"

import type { PageSource, PageSourceExecution } from "../../domain/page/page-content.js"
import type { ImageTransformer } from "../../ports/ImageTransformer.js"
import { PriorityResourceScheduler } from "../scheduler/PriorityResourceScheduler.js"
import { transformPageSource } from "./transform-page-source.js"

const REQUEST = { width: 1, dpr: 1, fit: "inside", format: "webp", quality: 80 } as const

describe("transformPageSource", () => {
  it("[neoview.image.shared-source-lease] uses one CPU lease across source and transformer", async () => {
    const release = vi.fn()
    const lease = { release }
    const acquire = vi.fn(async () => lease)
    let sourceLease: PageSourceExecution["resourceLease"]
    let transformerLease: unknown
    const source = pageSource((execution) => {
      sourceLease = execution?.resourceLease
      return byteStream(Uint8Array.of(1))
    })
    const transformer: ImageTransformer = {
      async transform(_input, _request, _signal, execution) {
        transformerLease = execution?.resourceLease
        return { contentType: "image/webp", stream: byteStream(Uint8Array.of(2)) }
      },
    }

    const result = await transformPageSource(source, transformer, REQUEST, undefined, {
      kind: "neoview.thumbnail.generate",
      priority: "background",
      ownerId: "page:1",
    }, { acquire })
    expect(acquire).toHaveBeenCalledOnce()
    expect(acquire).toHaveBeenCalledWith({
      resource: "cpu",
      kind: "neoview.thumbnail.generate",
      priority: "background",
      ownerId: "page:1",
    }, undefined)
    expect(sourceLease).toBe(lease)
    expect(transformerLease).toBe(lease)
    expect(release).not.toHaveBeenCalled()
    expect(new Uint8Array(await new Response(result.stream).arrayBuffer())).toEqual(Uint8Array.of(2))
    expect(release).toHaveBeenCalledOnce()
  })

  it("[neoview.image.shared-source-cancel] releases the shared lease exactly once on cancel and abort", async () => {
    const release = vi.fn()
    const abort = new AbortController()
    const source = pageSource(() => byteStream(Uint8Array.of(1)))
    const transformer: ImageTransformer = {
      async transform() {
        return { contentType: "image/webp", stream: new ReadableStream<Uint8Array>() }
      },
    }
    const result = await transformPageSource(source, transformer, REQUEST, abort.signal, {}, {
      acquire: async () => ({ release }),
    })
    await result.stream.cancel("no longer visible")
    abort.abort(new Error("session closed"))
    expect(release).toHaveBeenCalledOnce()
  })

  it("[neoview.image.shared-source-cancel] releases the lease and cancels an input stream that opens after abort", async () => {
    const controller = new AbortController()
    const lateInput = Promise.withResolvers<ReadableStream<Uint8Array>>()
    const release = vi.fn()
    const cancel = vi.fn()
    const open = vi.fn(() => lateInput.promise)
    const source: PageSource = {
      rangeSupported: false,
      transformResource: "cpu",
      open,
      async close() {},
      async [Symbol.asyncDispose]() {},
    }
    const transformer: ImageTransformer = {
      transform: vi.fn(),
    }
    const pending = transformPageSource(source, transformer, REQUEST, controller.signal, {}, {
      acquire: async () => ({ release }),
    })

    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce())
    controller.abort(new DOMException("page changed", "AbortError"))
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(release).toHaveBeenCalledOnce()
    expect(transformer.transform).not.toHaveBeenCalled()
    lateInput.resolve(new ReadableStream<Uint8Array>({ cancel }))
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
  })

  it("[neoview.image.shared-source-single-slot] completes without reacquiring the only CPU slot", async () => {
    const scheduler = new PriorityResourceScheduler({ maxConcurrent: 1, reservedInteractive: 0 })
    const acquire = vi.spyOn(scheduler, "acquire")
    const transformer = leaseAwareTransformer(scheduler)
    const result = await transformPageSource(
      pageSource(() => byteStream(Uint8Array.of(1))),
      transformer,
      REQUEST,
      undefined,
      {},
      scheduler,
    )
    expect(new Uint8Array(await new Response(result.stream).arrayBuffer())).toEqual(Uint8Array.of(2))
    expect(acquire).toHaveBeenCalledOnce()
    expect(scheduler.active).toBe(0)
  })

  it("[neoview.image.shared-source-concurrent] completes two transforms with two CPU slots", async () => {
    const scheduler = new PriorityResourceScheduler({ maxConcurrent: 2, reservedInteractive: 0 })
    const acquire = vi.spyOn(scheduler, "acquire")
    const transformer = leaseAwareTransformer(scheduler)
    const results = await Promise.all([1, 2].map(() => transformPageSource(
      pageSource(() => byteStream(Uint8Array.of(1))),
      transformer,
      REQUEST,
      undefined,
      {},
      scheduler,
    )))
    await Promise.all(results.map((result) => new Response(result.stream).arrayBuffer()))
    expect(acquire).toHaveBeenCalledTimes(2)
    expect(scheduler.active).toBe(0)
  })
})

function leaseAwareTransformer(scheduler: PriorityResourceScheduler): ImageTransformer {
  return {
    async transform(_input, _request, signal, execution) {
      const ownsLease = !execution?.resourceLease
      const lease = execution?.resourceLease ?? await scheduler.acquire({
        resource: "cpu",
        kind: "nested-transform",
        priority: "interactive",
      }, signal)
      if (ownsLease) lease.release()
      return { contentType: "image/webp", stream: byteStream(Uint8Array.of(2)) }
    },
  }
}

function pageSource(openStream: (execution?: PageSourceExecution) => ReadableStream<Uint8Array>): PageSource {
  return {
    rangeSupported: false,
    transformResource: "cpu",
    async open(_signal, _range, execution) { return openStream(execution) },
    async close() {},
    async [Symbol.asyncDispose]() {},
  }
}

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } })
}
