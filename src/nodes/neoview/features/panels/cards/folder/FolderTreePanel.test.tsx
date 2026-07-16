import { act, fireEvent, render, waitFor, within } from "@testing-library/react"
import { VirtuosoMockContext } from "react-virtuoso"
import { describe, expect, it, vi } from "vitest"

import type { ReaderDirectoryTreePageDto, ReaderHttpClient } from "../../../../adapters/reader-http-client"
import FolderTreePanel, { directoryAncestors, directoryPathKey, directoryRoot } from "./FolderTreePanel"

describe("FolderTreePanel", () => {
  it("[neoview.folder.tree-paths] resolves Windows, POSIX and UNC ancestor chains", () => {
    expect(directoryRoot("D:\\books\\series")).toBe("D:\\")
    expect(directoryAncestors("D:\\books\\series")).toEqual(["D:\\", "D:\\books", "D:\\books\\series"])
    expect(directoryRoot("/srv/books")).toBe("/")
    expect(directoryAncestors("/srv/books")).toEqual(["/", "/srv", "/srv/books"])
    expect(directoryRoot("\\\\server\\share\\books")).toBe("//server/share/")
    expect(directoryAncestors("\\\\server\\share\\books")).toEqual(["//server/share/", "//server/share/books"])
    expect(directoryPathKey("D:\\Library\\BOOKS")).toBe(directoryPathKey("d:\\library\\books"))
    expect(directoryPathKey("\\\\SERVER\\Share\\Books")).toBe(directoryPathKey("//server/share/books"))
    expect(directoryPathKey("/Library/Books")).not.toBe(directoryPathKey("/library/books"))
  })

  it("[neoview.folder.tree-panel] auto-expands, virtualizes, navigates and retries failed nodes", async () => {
    let brokenAttempts = 0
    const treeDirectoryBrowser = vi.fn(async (_sessionId: string, path?: string): Promise<ReaderDirectoryTreePageDto> => {
      if (path === "C:\\broken") {
        brokenAttempts += 1
        if (brokenAttempts === 1) throw new Error("拒绝访问")
      }
      return treePage(path ?? "C:\\", path === "C:\\"
        ? [directory("books", "C:\\books"), directory("broken", "C:\\broken")]
        : path === "C:\\books"
          ? [directory("series", "C:\\books\\series"), directory("empty", "C:\\books\\empty")]
          : path === "C:\\books\\series"
            ? [directory("volume", "C:\\books\\series\\volume")]
            : [])
    })
    const onNavigate = vi.fn()
    const view = renderTree({ treeDirectoryBrowser } as unknown as ReaderHttpClient, "C:\\books\\series", onNavigate)
    const ui = within(view.container)

    await waitFor(() => expect(ui.getByTitle("C:\\books\\series").getAttribute("aria-current")).toBe("page"))
    expect(treeDirectoryBrowser).toHaveBeenCalledWith("tree-1", "C:\\", false, expect.any(AbortSignal))
    expect(treeDirectoryBrowser).toHaveBeenCalledWith("tree-1", "C:\\books", false, expect.any(AbortSignal))
    expect(treeDirectoryBrowser).toHaveBeenCalledWith("tree-1", "C:\\books\\series", false, expect.any(AbortSignal))

    fireEvent.click(ui.getByTitle("C:\\books"))
    expect(onNavigate).toHaveBeenCalledWith("C:\\books")

    fireEvent.click(ui.getByLabelText("折叠books"))
    await waitFor(() => expect(ui.queryByTitle("C:\\books\\series")).toBeNull())
    fireEvent.click(ui.getByLabelText("展开books"))
    await waitFor(() => expect(ui.getByTitle("C:\\books\\series")).toBeTruthy())

    fireEvent.click(ui.getByLabelText("展开broken"))
    await waitFor(() => expect(ui.getByText("拒绝访问")).toBeTruthy())
    fireEvent.click(ui.getByLabelText("重试加载broken"))
    await waitFor(() => expect(ui.getByText("空")).toBeTruthy())
    expect(treeDirectoryBrowser).toHaveBeenLastCalledWith("tree-1", "C:\\broken", true, expect.any(AbortSignal))
  })

  it("[neoview.folder.tree-lifecycle] aborts in-flight node reads on unmount", async () => {
    let signal!: AbortSignal
    const treeDirectoryBrowser = vi.fn((_sessionId: string, _path?: string, _refresh?: boolean, nextSignal?: AbortSignal) => {
      signal = nextSignal!
      return new Promise<ReaderDirectoryTreePageDto>(() => undefined)
    })
    const view = renderTree({ treeDirectoryBrowser } as unknown as ReaderHttpClient, "C:\\books", vi.fn())
    await waitFor(() => expect(treeDirectoryBrowser).toHaveBeenCalled())
    view.unmount()
    expect(signal.aborted).toBe(true)
  })

  it("[neoview.folder.tree-navigation-race] aborts obsolete ancestor loads and ignores their late response", async () => {
    let oldSignal!: AbortSignal
    let resolveOld!: (page: ReaderDirectoryTreePageDto) => void
    const treeDirectoryBrowser = vi.fn((_sessionId: string, path?: string, _refresh?: boolean, signal?: AbortSignal) => {
      if (path === "C:\\old") {
        oldSignal = signal!
        return new Promise<ReaderDirectoryTreePageDto>((resolve) => { resolveOld = resolve })
      }
      return Promise.resolve(treePage(path ?? "C:\\", path === "C:\\"
        ? [directory("old", "C:\\old"), directory("new", "C:\\new")]
        : []))
    })
    const client = { treeDirectoryBrowser } as unknown as ReaderHttpClient
    const view = renderTree(client, "C:\\old", vi.fn())

    await waitFor(() => expect(treeDirectoryBrowser).toHaveBeenCalledWith(
      "tree-1", "C:\\old", false, expect.any(AbortSignal),
    ))
    view.rerender(treeElement(client, "C:\\new", vi.fn()))
    await waitFor(() => expect(within(view.container).getByTitle("C:\\new").parentElement?.dataset.current).toBe("true"))
    expect(oldSignal.aborted).toBe(true)

    await act(async () => {
      resolveOld(treePage("C:\\old", [directory("stale", "C:\\old\\stale")]))
      await Promise.resolve()
    })
    expect(within(view.container).queryByTitle("C:\\old\\stale")).toBeNull()
  })

  it("[neoview.folder.tree-generation] rebases expanded pages when the backend cache generation advances", async () => {
    let generation = 1
    let brokenAttempts = 0
    const treeDirectoryBrowser = vi.fn(async (_sessionId: string, path?: string): Promise<ReaderDirectoryTreePageDto> => {
      if (path === "C:\\broken") {
        brokenAttempts += 1
        if (brokenAttempts === 1) throw new Error("读取失败")
        return { ...treePage(path, []), generation }
      }
      const entries = generation === 1
        ? [directory("broken", "C:\\broken")]
        : [directory("fresh", "C:\\fresh")]
      return { ...treePage(path ?? "C:\\", entries), generation }
    })
    const view = renderTree({ treeDirectoryBrowser } as unknown as ReaderHttpClient, "C:\\", vi.fn())
    const ui = within(view.container)

    await waitFor(() => expect(ui.getByTitle("C:\\broken")).toBeTruthy())
    fireEvent.click(ui.getByLabelText("展开broken"))
    await waitFor(() => expect(ui.getByText("读取失败")).toBeTruthy())
    generation = 2
    fireEvent.click(ui.getByLabelText("重试加载broken"))

    await waitFor(() => expect(ui.getByTitle("C:\\fresh")).toBeTruthy())
    expect(ui.queryByTitle("C:\\broken")).toBeNull()
  })
})

function renderTree(client: ReaderHttpClient, currentPath: string, onNavigate: (path: string) => void) {
  return render(treeElement(client, currentPath, onNavigate))
}

function treeElement(client: ReaderHttpClient, currentPath: string, onNavigate: (path: string) => void) {
  return (
    <VirtuosoMockContext.Provider value={{ viewportHeight: 288, itemHeight: 30 }}>
      <FolderTreePanel client={client} sessionId="tree-1" currentPath={currentPath} disabled={false} onNavigate={onNavigate} />
    </VirtuosoMockContext.Provider>
  )
}

function directory(name: string, path: string) {
  return { name, path, kind: "directory" as const, readerSupported: false }
}

function treePage(path: string, entries: ReturnType<typeof directory>[]): ReaderDirectoryTreePageDto {
  return { sessionId: "tree-1", path, entries, generation: 1, cacheHit: false, excludedPaths: [] }
}
