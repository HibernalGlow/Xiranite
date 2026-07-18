import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderDirectoryPageDto, ReaderHttpClient } from "../../../../adapters/reader-http-client"
import { createDirectoryCatalog, directoryEntryAt } from "./DirectoryCatalog"
import FolderEmmEditor from "./FolderEmmEditor"

afterEach(cleanup)

describe("FolderEmmEditor", () => {
  it("[neoview.folder.emm-edit-ui] uses the loaded revision and refreshes one successful optimistic update", async () => {
    let catalog = createDirectoryCatalog(page())
    const readDirectoryEmm = vi.fn(async () => ({
      generation: 3,
      items: [{ path: "D:/library/A.cbz", metadata: { revision: 2, overrides: { rating: 4, manualTags: [{ namespace: "artist", tag: "Alice" }] }, inherited: ["translatedTitle"] as const } }],
    }))
    const editDirectoryEmm = vi.fn(async (_sessionId, command) => {
      expect(command).toEqual({
        generation: 3,
        updates: [{ path: "D:/library/A.cbz", expectedRevision: 2, patch: { rating: 5, manualTags: [{ namespace: "artist", tag: "Alice" }] } }],
      })
      expect(directoryEntryAt(catalog, 0)?.rating).toBe(5)
      return {
        generation: 4,
        refreshRequired: false,
        entries: [{ name: "A.cbz", path: "D:/library/A.cbz", kind: "file" as const, readerSupported: true, rating: 5 }],
        results: [{ index: 0, status: "succeeded" as const, metadata: { revision: 3, overrides: { rating: 5 }, inherited: ["manualTags", "translatedTitle"] as const } }],
        succeeded: 1,
        conflicts: 0,
        failed: 0,
      }
    })
    const onRefresh = vi.fn(async () => undefined)
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <FolderEmmEditor
        client={clientWith({ readDirectoryEmm, editDirectoryEmm })}
        sessionId="browser-1"
        generation={3}
        selection={{ generation: 3, allSelected: false, ranges: [], explicit: [{ path: "D:/library/A.cbz", index: 0 }] }}
        selectedCount={1}
        fallbackEntry={{ path: "D:/library/A.cbz", name: "A.cbz" }}
        onCatalogUpdate={(update) => { catalog = update(catalog) }}
        onRefresh={onRefresh}
        onClose={onClose}
      />,
    )

    await screen.findByRole("dialog")
    await waitFor(() => expect((screen.getByRole("radio", { name: "5 星" }) as HTMLButtonElement).disabled).toBe(false))
    await user.click(screen.getByRole("radio", { name: "5 星" }))
    await user.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(onRefresh).not.toHaveBeenCalled()
    expect(catalog.generation).toBe(4)
  })

  it("[neoview.folder.emm-edit-rollback-ui] resolves sparse targets and rolls back only a conflicting item", async () => {
    let catalog = createDirectoryCatalog(page())
    const resolveDirectorySelection = vi.fn(async () => ({
      sessionId: "browser-1", generation: 3, total: 2, selectedCount: 2,
      preview: ["D:/library/A.cbz", "D:/library/B.cbz"], truncated: false,
    }))
    const readDirectoryEmm = vi.fn()
      .mockResolvedValueOnce({
        generation: 3,
        items: [
          { path: "D:/library/A.cbz", metadata: { revision: 1, overrides: { rating: 3 }, inherited: ["manualTags", "translatedTitle"] } },
          { path: "D:/library/B.cbz", metadata: { revision: 2, overrides: { rating: 2 }, inherited: ["manualTags", "translatedTitle"] } },
        ],
      })
      .mockResolvedValueOnce({
        generation: 4,
        items: [
          { path: "D:/library/A.cbz", metadata: { revision: 2, overrides: { rating: 5 }, inherited: ["manualTags", "translatedTitle"] } },
          { path: "D:/library/B.cbz", metadata: { revision: 3, overrides: { rating: 4 }, inherited: ["manualTags", "translatedTitle"] } },
        ],
      })
    const editDirectoryEmm = vi.fn(async () => {
      expect(directoryEntryAt(catalog, 0)?.rating).toBe(5)
      expect(directoryEntryAt(catalog, 1)?.rating).toBe(5)
      return {
        generation: 4,
        refreshRequired: false,
        entries: [{ name: "A.cbz", path: "D:/library/A.cbz", kind: "file" as const, readerSupported: true, rating: 5 }],
        results: [
          { index: 0, status: "succeeded" as const, metadata: { revision: 2, overrides: { rating: 5 }, inherited: ["manualTags", "translatedTitle"] as const } },
          { index: 1, status: "conflict" as const, actualRevision: 3 },
        ],
        succeeded: 1,
        conflicts: 1,
        failed: 0,
      }
    })
    const onRefresh = vi.fn(async () => undefined)
    const user = userEvent.setup()
    render(
      <FolderEmmEditor
        client={clientWith({ resolveDirectorySelection, readDirectoryEmm, editDirectoryEmm })}
        sessionId="browser-1"
        generation={3}
        selection={{ generation: 3, allSelected: false, ranges: [{ start: 0, end: 1 }], explicit: [] }}
        selectedCount={2}
        fallbackEntry={{ path: "D:/library/A.cbz", name: "A.cbz" }}
        onCatalogUpdate={(update) => { catalog = update(catalog) }}
        onRefresh={onRefresh}
        onClose={vi.fn()}
      />,
    )

    await waitFor(() => expect((screen.getByRole("radio", { name: "5 星" }) as HTMLButtonElement).disabled).toBe(false))
    await user.click(screen.getByRole("radio", { name: "5 星" }))
    await user.click(screen.getByRole("button", { name: "保存" }))

    expect((await screen.findByRole("alert")).textContent).toContain("已保存 1 项，冲突 1 项")
    expect(directoryEntryAt(catalog, 0)?.rating).toBe(5)
    expect(directoryEntryAt(catalog, 1)?.rating).toBe(2)
    expect(onRefresh).not.toHaveBeenCalled()
    expect(readDirectoryEmm).toHaveBeenLastCalledWith("browser-1", 4, ["D:/library/A.cbz", "D:/library/B.cbz"], expect.any(AbortSignal))
  })

  it("[neoview.folder.emm-edit-sort-projection] reloads the current projection only when metadata changes its order", async () => {
    const onRefresh = vi.fn(async () => undefined)
    const user = userEvent.setup()
    render(
      <FolderEmmEditor
        client={clientWith({
          readDirectoryEmm: vi.fn(async () => ({
            generation: 3,
            items: [{ path: "D:/library/A.cbz", metadata: { revision: 1, overrides: { rating: 3 }, inherited: ["manualTags", "translatedTitle"] } }],
          })),
          editDirectoryEmm: vi.fn(async () => ({
            generation: 4,
            refreshRequired: true,
            entries: [{ name: "A.cbz", path: "D:/library/A.cbz", kind: "file" as const, readerSupported: true, rating: 5 }],
            results: [{ index: 0, status: "succeeded" as const, metadata: { revision: 2, overrides: { rating: 5 }, inherited: ["manualTags", "translatedTitle"] as const } }],
            succeeded: 1,
            conflicts: 0,
            failed: 0,
          })),
        })}
        sessionId="browser-1"
        generation={3}
        selection={{ generation: 3, allSelected: false, ranges: [], explicit: [{ path: "D:/library/A.cbz", index: 0 }] }}
        selectedCount={1}
        fallbackEntry={{ path: "D:/library/A.cbz", name: "A.cbz" }}
        onCatalogUpdate={vi.fn()}
        onRefresh={onRefresh}
        onClose={vi.fn()}
      />,
    )

    await waitFor(() => expect((screen.getByRole("radio", { name: "5 星" }) as HTMLButtonElement).disabled).toBe(false))
    await user.click(screen.getByRole("radio", { name: "5 星" }))
    await user.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalledWith("D:/library/A.cbz"))
  })
})

function page(): ReaderDirectoryPageDto {
  return {
    sessionId: "browser-1",
    navigationEntryId: 1,
    path: "D:/library",
    entries: [
      { name: "A.cbz", path: "D:/library/A.cbz", kind: "file", readerSupported: true, rating: 3 },
      { name: "B.cbz", path: "D:/library/B.cbz", kind: "file", readerSupported: true, rating: 2 },
    ],
    cursor: 0,
    total: 2,
    canGoBack: false,
    canGoForward: false,
    generation: 3,
    filter: "all",
    filterOptions: ["all"],
    sort: { field: "name", order: "asc", directoriesFirst: true },
    sortFields: ["name", "rating"],
    metadataFields: ["rating", "tags"],
    metadataCapabilities: ["rating", "tags"],
    sortSource: "memory",
    sortTemporary: false,
    globalDefaultSort: { field: "name", order: "asc", directoriesFirst: true },
    tabDefaultSort: { field: "name", order: "asc", directoriesFirst: true },
    watching: false,
  }
}

function clientWith(actions: Partial<ReaderHttpClient>): ReaderHttpClient {
  return {
    config: vi.fn(), updateSidebarLayout: vi.fn(), updateCardLayout: vi.fn(), updateBoardLayout: vi.fn(), updateViewDefaults: vi.fn(),
    updateSlideshow: vi.fn(), open: vi.fn(), listPages: vi.fn(), navigate: vi.fn(), goTo: vi.fn(), updateSessionOptions: vi.fn(), close: vi.fn(),
    suggestDirectoryEmmTags: vi.fn(async () => []),
    ...actions,
  }
}
