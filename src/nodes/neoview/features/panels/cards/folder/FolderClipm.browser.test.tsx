import type { ClipmData, ClipmInput } from "@xiranite/node-clipm/core"
import { useRef, useState } from "react"
import { afterEach, expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { cleanup, render } from "vitest-browser-react"

import { READER_FOLDER_DETAIL_DEFAULT_WIDTHS, type ReaderDirectoryEntryDto } from "../../../../adapters/reader-http-client"
import { createDirectoryCatalog, directoryEntryAt, type DirectoryCatalog } from "./DirectoryCatalog"
import { createDirectorySelection } from "./DirectorySelection"
import { FolderClipmBadge, FolderClipmProvider } from "./FolderClipmContext"
import { DirectoryListItem } from "./FolderDirectoryListItem"
import FolderDetailsView from "./FolderDetailsView"
import { DirectoryBannerItem, DirectoryGridItem } from "./FolderGridWorkspace"
import { DirectoryMosaicItem } from "./FolderMosaicWorkspace"
import { useFolderClipmController } from "./useFolderClipmController"

afterEach(cleanup)

test("[neoview.folder.clipm-gui] scores CM -- and saves a correction without opening the comic", async () => {
  const openComic = vi.fn()
  const relocations: Array<[string, string]> = []
  const refreshed: string[][] = []
  const invokeClipm = vi.fn(async (input: ClipmInput) => successfulResult(input))

  await render(<Harness onOpenComic={openComic} relocations={relocations} refreshed={refreshed} invokeClipm={invokeClipm} />)
  await page.getByRole("button", { name: /尚未评分/ }).click()

  expect(openComic).not.toHaveBeenCalled()
  await expect.element(page.getByText("800", { exact: true }).first()).toBeVisible()
  await expect.element(page.getByTestId("clipm-catalog-path")).toHaveTextContent("Book [CM1P0873-4K7Q].cbz")
  await page.getByText("N 不喜欢", { exact: true }).click()
  await page.getByRole("spinbutton", { name: "ClipM 人工评分" }).fill("342")
  await page.getByRole("button", { name: "保存修正" }).click()

  await expect.poll(() => invokeClipm.mock.calls.map((call) => call[0])).toContainEqual(expect.objectContaining({
    action: "feedback-apply",
    workId: WORK_ID,
    classification: "N",
    ranking: 342,
    source: "neoview",
  }))
  await expect.element(page.getByTestId("clipm-catalog-path")).toHaveTextContent("Book [CM1N0342-4K7Q].cbz")
  await expect.element(page.getByTestId("clipm-focused-path")).toHaveTextContent("Book [CM1N0342-4K7Q].cbz")
  expect(relocations).toEqual([
    ["D:/Comics/Book.cbz", "D:/Comics/Book [CM1P0873-4K7Q].cbz"],
    ["D:/Comics/Book [CM1P0873-4K7Q].cbz", "D:/Comics/Book [CM1N0342-4K7Q].cbz"],
  ])
  expect(refreshed.at(-1)).toEqual(["D:/Comics/Book [CM1N0342-4K7Q].cbz"])
})

test("[neoview.folder.clipm-rollback-gui] restores the optimistic badge and path when feedback fails", async () => {
  const relocations: Array<[string, string]> = []
  const invokeClipm = vi.fn(async (input: ClipmInput) => {
    if (input.action === "feedback-apply") throw new Error("database locked")
    return successfulResult(input)
  })

  await render(<Harness onOpenComic={vi.fn()} relocations={relocations} refreshed={[]} invokeClipm={invokeClipm} />)
  await page.getByRole("button", { name: /尚未评分/ }).click()
  await expect.element(page.getByText("800", { exact: true }).first()).toBeVisible()
  await page.getByText("N 不喜欢", { exact: true }).click()
  await page.getByRole("spinbutton", { name: "ClipM 人工评分" }).fill("342")
  await page.getByRole("button", { name: "保存修正" }).click()

  await expect.element(page.getByRole("alert")).toHaveTextContent("database locked")
  await expect.element(page.getByTestId("clipm-catalog-path")).toHaveTextContent("Book [CM1P0873-4K7Q].cbz")
  await expect.element(page.getByTestId("clipm-focused-path")).toHaveTextContent("Book [CM1P0873-4K7Q].cbz")
  expect(relocations.slice(-2)).toEqual([
    ["D:/Comics/Book [CM1P0873-4K7Q].cbz", "D:/Comics/Book [CM1N0342-4K7Q].cbz"],
    ["D:/Comics/Book [CM1N0342-4K7Q].cbz", "D:/Comics/Book [CM1P0873-4K7Q].cbz"],
  ])
})

test("[neoview.folder.clipm-views-gui] exposes one shared badge in every File Card view", async () => {
  const openWork = vi.fn()
  const entry: ReaderDirectoryEntryDto = {
    name: "Book [CM1P0873-4K7Q].cbz",
    path: "D:/Comics/Book [CM1P0873-4K7Q].cbz",
    kind: "file",
    readerSupported: true,
  }
  const common = {
    entry,
    disabled: false,
    selected: false,
    focused: false,
    showRating: false,
    showCollectTagCount: false,
    hoverPreviewEnabled: false,
    hoverPreviewDelayMs: 0,
    onSelect: vi.fn(),
  }
  const detailsCatalog = createDirectoryCatalog(directoryPage(entry))
  await render(
    <FolderClipmProvider value={{ openWork }}>
      <div className="grid w-[900px] grid-cols-3 gap-2">
        <DirectoryListItem {...common} itemId="compact" index={0} visualMode="compact" contentWidthPercent={30} deleteMode={false} deleteStrategy="trash" confirmDelete />
        <DirectoryListItem {...common} itemId="cover-list" index={1} visualMode="cover-list" contentWidthPercent={30} deleteMode={false} deleteStrategy="trash" confirmDelete />
        <DirectoryBannerItem {...common} itemId="mosaic-list" index={2} visualMode="mosaic-list" />
        <DirectoryGridItem {...common} itemId="cover-grid" index={3} visualMode="cover-grid" />
        <DirectoryMosaicItem {...common} itemId="mosaic-grid" index={4} span="square" previewReady={false} columnCount={3} deleteMode={false} deleteStrategy="trash" confirmDelete onDimensions={vi.fn()} />
        <div className="col-span-3 h-64">
          <FolderDetailsView
            catalog={detailsCatalog}
            disabled={false}
            selectedPaths={new Set()}
            layout={{
              columnOrder: ["name", "clipm", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "rating", "tags"],
              hiddenColumns: [],
              pinnedLeft: ["name"],
              pinnedRight: [],
              columnWidths: READER_FOLDER_DETAIL_DEFAULT_WIDTHS,
            }}
            onRangeChange={() => undefined}
            onSelect={() => undefined}
            onLayoutChange={() => undefined}
            showReturnFooter={false}
            returnFooterContext={{ onReturn: () => undefined }}
          />
        </div>
      </div>
    </FolderClipmProvider>,
  )

  await expect.poll(() => document.querySelectorAll('[data-folder-clipm-badge="P"]').length).toBe(6)
  document.querySelector<HTMLButtonElement>('[data-folder-clipm-badge="P"]')!.click()
  expect(openWork).toHaveBeenCalledWith(expect.objectContaining({ path: entry.path }))
})

function Harness({
  onOpenComic,
  relocations,
  refreshed,
  invokeClipm,
}: {
  onOpenComic(): void
  relocations: Array<[string, string]>
  refreshed: string[][]
  invokeClipm(input: ClipmInput): Promise<ClipmData>
}) {
  const [catalog, setCatalog] = useState<DirectoryCatalog>(() => createDirectoryCatalog(directoryPage()))
  const catalogRef = useRef<DirectoryCatalog | undefined>(catalog)
  const [selection, setSelection] = useState(() => createDirectorySelection(catalog.generation))
  const [focusedPath, setFocusedPath] = useState("D:/Comics/Book.cbz")
  const controller = useFolderClipmController({
    catalogRef,
    setFocusedPath,
    setSelection,
    commitCatalog(next) {
      catalogRef.current = next
      setCatalog(next)
    },
    async refreshThumbnails(paths) {
      refreshed.push([...paths])
    },
    onSourcePathRelocated(sourcePath, destinationPath) {
      relocations.push([sourcePath, destinationPath])
    },
    setError: () => undefined,
    invokeClipm,
  })
  catalogRef.current = catalog
  const entry = directoryEntryAt(catalog, 0)!
  return (
    <FolderClipmProvider value={controller.context}>
      <div onClick={onOpenComic}><FolderClipmBadge entry={entry} /></div>
      <output data-testid="clipm-catalog-path">{entry.path}</output>
      <output data-testid="clipm-focused-path">{focusedPath}</output>
      <output data-testid="clipm-selection-size">{selection.explicit.size}</output>
      {controller.dialog}
    </FolderClipmProvider>
  )
}

const WORK_ID = "018f0000-0000-7000-8000-000000000001"

function successfulResult(input: ClipmInput): ClipmData {
  const label = input.action === "feedback-apply" ? input.classification ?? "P" : "P"
  const score = input.action === "feedback-apply" ? input.ranking ?? 873 : 873
  const work = {
    workId: WORK_ID,
    path: `D:/Comics/Book [CM1${label}${String(score).padStart(4, "0")}-4K7Q].cbz`,
    label,
    score,
    predictedLabel: "P",
    predictedScore: 800,
    classificationCorrected: input.action === "feedback-apply",
    rankingCorrected: input.action === "feedback-apply",
    bundleVersion: 1,
    shortCode: "4K7Q",
    metadataWriteStatus: "written",
    renamed: true,
  }
  return input.action === "feedback-apply"
    ? { action: "feedback-apply", result: { work } }
    : { action: "score", result: work }
}

function directoryPage(entry: ReaderDirectoryEntryDto = { name: "Book.cbz", path: "D:/Comics/Book.cbz", kind: "file", readerSupported: true }) {
  return {
    sessionId: "browser-1",
    navigationEntryId: 1,
    path: "D:/Comics",
    entries: [entry],
    cursor: 0,
    total: 1,
    canGoBack: false,
    canGoForward: false,
    generation: 1,
    sort: { field: "name" as const, order: "asc" as const, directoriesFirst: true },
    sortFields: ["name" as const],
    metadataFields: [],
    sortSource: "global-default" as const,
    sortTemporary: false,
    globalDefaultSort: { field: "name" as const, order: "asc" as const, directoriesFirst: true },
    tabDefaultSort: { field: "name" as const, order: "asc" as const, directoriesFirst: true },
  }
}
