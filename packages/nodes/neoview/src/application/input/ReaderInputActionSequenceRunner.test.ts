import { describe, expect, it, vi } from "vitest"

import type { ReaderInputBinding } from "../../domain/input/ReaderInputBindings.js"
import { executeReaderInputActionSequence, ReaderInputActionSequenceRunner } from "./ReaderInputActionSequenceRunner.js"

describe("ReaderInputActionSequenceRunner", () => {
  it("[neoview.bindings.action-sequence-runtime] executes configured actions serially and passes adjacent step context", async () => {
    const order: string[] = []
    const execute = vi.fn(async (action, context) => {
      order.push(`start:${action}`)
      await Promise.resolve()
      order.push(`end:${action}`)
      expect(context.bindingId).toBe("delete-next")
      return { status: "succeeded" as const }
    })

    await expect(executeReaderInputActionSequence(binding(), execute)).resolves.toMatchObject({
      status: "succeeded",
      completedActions: 3,
      action: "reader.first-page",
    })
    expect(order).toEqual([
      "start:file.delete-current", "end:file.delete-current",
      "start:reader.next-book", "end:reader.next-book",
      "start:reader.first-page", "end:reader.first-page",
    ])
    expect(execute.mock.calls[0]?.[1]).toMatchObject({ index: 0, nextAction: "reader.next-book" })
    expect(execute.mock.calls[0]?.[1].input).toEqual({ device: "keyboard", code: "Delete" })
    expect(execute.mock.calls[1]?.[1]).toMatchObject({ index: 1, nextAction: "reader.first-page", previousOutcome: { status: "succeeded" } })
  })

  it.each(["cancelled", "unavailable", "failed"] as const)("stops after a %s action outcome", async (status) => {
    const execute = vi.fn(async () => status === "failed"
      ? { status, error: new Error("failed") } as const
      : { status } as const)
    const result = await executeReaderInputActionSequence(binding(), execute)
    expect(result).toMatchObject({ status, completedActions: 0, action: "file.delete-current" })
    expect(execute).toHaveBeenCalledOnce()
  })

  it("[neoview.bindings.action-sequence-single-flight] coalesces repeats until one sequence settles", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const execute = vi.fn(async () => {
      await gate
      return { status: "succeeded" as const }
    })
    const runner = new ReaderInputActionSequenceRunner()
    const first = runner.run(binding(), execute)
    const repeat = runner.run(binding(), execute)
    expect(repeat).toBe(first)
    release()
    await first
    expect(execute).toHaveBeenCalledTimes(3)
    await runner.run(binding(), execute)
    expect(execute).toHaveBeenCalledTimes(6)
  })
})

function binding(): ReaderInputBinding {
  return {
    id: "delete-next",
    action: "file.delete-current",
    followUpActions: ["reader.next-book", "reader.first-page"],
    context: "reader",
    enabled: true,
    input: { device: "keyboard", code: "Delete" },
  }
}
