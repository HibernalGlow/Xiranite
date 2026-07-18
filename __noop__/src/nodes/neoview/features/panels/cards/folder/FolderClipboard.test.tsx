import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderDirectoryClipboardSnapshotDto, ReaderHttpClient } from "../../../../adapters/reader-http-client"
import { FolderClipboardProvider, useFolderClipboard } from "./FolderClipboard"

afterEach(cleanup)

describe("FolderClipboardProvider", () => {
  it("[neoview.folder.clipboard-lifecycle] ignores a late initial read and consumes cut on paste", async () => {
    const initial = deferred<ReaderDirectoryClipboardSnapshotDto>()
    const prepared = { available: true as const, mode: "move" as const, generation: 5, total: 2, createdAt: 10 }
    const running = operation({ status: "running", processed: 0 })
    const completed = operation({ status: "completed", processed: 2, succeeded: 2, completedAt: 20 })
    const client = {
      directoryClipboard: vi.fn(() => initial.promise),
      prepareDirectoryClipboard: vi.fn(async () => prepared),
      pasteDirectoryClipboard: vi.fn(async () => running),
      directorySelectionOperation: vi.fn(async () => completed),
      cancelDirectorySelectionOperation: vi.fn(),
    } as unknown as ReaderHttpClient

    render(
      <FolderClipboardProvider client={client}>
        <ClipboardHarness />
      </FolderClipboardProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "prepare" }))
    await waitFor(() => expect(screen.getByTestId("clipboard").textContent).toBe("move:2"))
    initial.resolve({ available: false })
    await Promise.resolve()
    expect(screen.getByTestId("clipboard").textContent).toBe("move:2")

    fireEvent.click(screen.getByRole("button", { name: "paste" }))
    await waitFor(() => expect(screen.getByTestId("clipboard").textContent).toBe("empty"))
    await waitFor(() => expect(screen.getByTestId("operation").textContent).toBe("completed:2"))
    expect(client.pasteDirectoryClipboard).toHaveBeenCalledWith("D:/target")
  })

  it("[neoview.folder.clipboard-conflict-ui] publishes a bounded partial-failure summary", async () => {
    const prepared = { available: true as const, mode: "copy" as const, generation: 2, total: 3, createdAt: 1 }
    const running = operation({ id: "copy-1", kind: "copy", status: "running", total: 3 })
    const completed = operation({ ...running, status: "completed", processed: 3, succeeded: 2, failed: 1, completedAt: 2 })
    const client = {
      directoryClipboard: vi.fn(async () => prepared),
      pasteDirectoryClipboard: vi.fn(async () => running),
      directorySelectionOperation: vi.fn(async () => completed),
    } as unknown as ReaderHttpClient

    render(<FolderClipboardProvider client={client}><ClipboardHarness /></FolderClipboardProvider>)
    await waitFor(() => expect(screen.getByTestId("clipboard").textContent).toBe("copy:3"))
    fireEvent.click(screen.getByRole("button", { name: "paste" }))
    await waitFor(() => expect(screen.getByTestId("feedback").textContent).toContain("已复制 2 项，1 项失败"))
  })
})

function ClipboardHarness() {
  const clipboard = useFolderClipboard()
  return (
    <>
      <div data-testid="clipboard">{clipboard.clipboard.available ? `${clipboard.clipboard.mode}:${clipboard.clipboard.total}` : "empty"}</div>
      <div data-testid="operation">{clipboard.operation ? `${clipboard.operation.status}:${clipboard.operation.processed}` : "idle"}</div>
      <div data-testid="feedback">{clipboard.feedback?.text}</div>
      <button type="button" onClick={() => void clipboard.prepare("browser-1", {
        generation: 5,
        allSelected: false,
        ranges: [{ start: 0, end: 1 }],
        explicit: [],
      }, "move")}>prepare</button>
      <button type="button" onClick={() => void clipboard.paste("D:/target")}>paste</button>
    </>
  )
}

function operation(overrides: Record<string, unknown>) {
  return {
    id: "move-1",
    kind: "move" as const,
    destinationPath: "D:/target",
    status: "running" as const,
    generation: 5,
    total: 2,
    processed: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    failureSamples: [],
    failureSamplesTruncated: false,
    startedAt: 10,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
