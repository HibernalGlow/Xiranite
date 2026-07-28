import { describe, expect, it, vi } from "vitest"

import { dispatchReaderFileCardDeleteBinding } from "./ReaderFileCardDeleteBinding"

describe("Reader File Card delete binding", () => {
  it("routes a collapsed penetrated folder through the trash command", async () => {
    const dispatch = vi.fn(async () => sequenceResult())

    await expect(dispatchReaderFileCardDeleteBinding(
      "D:/books/series",
      "trash",
      dispatch,
    )).resolves.toEqual(sequenceResult())
    expect(dispatch).toHaveBeenCalledWith(
      { device: "command", command: "file-card.trash-current" },
      null,
      { kind: "file-entry-delete", targetPath: "D:/books/series", confirmationHandled: true },
    )
  })

  it("routes the concrete file selected from an auto-expanded branch", async () => {
    const dispatch = vi.fn(async () => sequenceResult())

    await expect(dispatchReaderFileCardDeleteBinding(
      "D:/books/series/inside/001.jpg",
      "delete",
      dispatch,
    )).resolves.toEqual(sequenceResult())
    expect(dispatch).toHaveBeenCalledWith(
      { device: "command", command: "file-card.delete-current" },
      null,
      { kind: "file-entry-delete", targetPath: "D:/books/series/inside/001.jpg", confirmationHandled: true },
    )
  })

  it("does not dispatch an empty target", async () => {
    const dispatch = vi.fn()
    await expect(dispatchReaderFileCardDeleteBinding(" ", "trash", dispatch)).resolves.toBeUndefined()
    expect(dispatch).not.toHaveBeenCalled()
  })
})

function sequenceResult() {
  return {
    bindingId: "system-file-card",
    status: "succeeded" as const,
    completedActions: 1,
    action: "file.delete-current" as const,
    outcome: { status: "succeeded" as const },
  }
}
