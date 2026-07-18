import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ContextMenuBuilderContext, type ContextMenuAPI } from "@/components/context-menu/context"
import type { ReaderDirectorySelectionOperationSnapshotDto, ReaderHttpClient } from "../../../../adapters/reader-http-client"
import FolderSelectionBar from "./FolderSelectionBar"

describe("FolderSelectionBar", () => {
  it("[neoview.folder.delete-batch-ui] confirms, polls and publishes bounded batch progress", async () => {
    const running = operation({ status: "running", processed: 0 })
    const completed = operation({ status: "completed", processed: 100_000, succeeded: 100_000 })
    const startDirectorySelectionOperation = vi.fn(async () => running)
    const directorySelectionOperation = vi.fn(async () => completed)
    const onTrashCompleted = vi.fn(async () => new Promise<void>((resolve) => setTimeout(resolve, 20)))
    const contextMenu: ContextMenuAPI = {
      register: () => () => undefined,
      show: () => undefined,
      confirm: (item) => { void item.onSelect?.() },
    }
    const client = {
      startDirectorySelectionOperation,
      directorySelectionOperation,
      cancelDirectorySelectionOperation: vi.fn(),
    } as unknown as ReaderHttpClient

    render(
      <ContextMenuBuilderContext.Provider value={contextMenu}>
        <FolderSelectionBar
          client={client}
          sessionId="browser-1"
          selection={{ generation: 7, allSelected: true, ranges: [], explicit: [] }}
          selectedCount={100_000}
          total={100_000}
          disabled={false}
          chainSelectMode={false}
          clickBehavior="select"
          onSelectAll={vi.fn()}
          onInvert={vi.fn()}
          onToggleChain={vi.fn()}
          onToggleClickBehavior={vi.fn()}
          onClear={vi.fn()}
          onClose={vi.fn()}
          onTrashCompleted={onTrashCompleted}
        />
      </ContextMenuBuilderContext.Provider>,
    )

    fireEvent.click(screen.getByLabelText("将所选项目移到回收站"))
    await waitFor(() => expect(startDirectorySelectionOperation).toHaveBeenCalledWith(
      "browser-1",
      { generation: 7, allSelected: true, ranges: [], explicit: [] },
      "trash",
    ))
    await waitFor(() => expect(directorySelectionOperation).toHaveBeenCalledWith(running.id, expect.any(AbortSignal)))
    await waitFor(() => expect(onTrashCompleted).toHaveBeenCalledWith(completed))
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("已将 100000 项移到回收站"))
  })
})

function operation(overrides: Partial<ReaderDirectorySelectionOperationSnapshotDto>): ReaderDirectorySelectionOperationSnapshotDto {
  return {
    id: "operation-1",
    kind: "trash",
    status: "running",
    generation: 7,
    total: 100_000,
    processed: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    failureSamples: [],
    failureSamplesTruncated: false,
    startedAt: 1,
    ...overrides,
  }
}
