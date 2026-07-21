import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient } from "../../../../adapters/reader-http-client"
import FolderBreadcrumbColumns from "./FolderBreadcrumbColumns"

afterEach(cleanup)

describe("FolderBreadcrumbColumns", () => {
  it("[neoview.folder.breadcrumb-columns] adapts the cached tree API to accessible Miller columns", async () => {
    const onNavigate = vi.fn()
    const treeDirectoryBrowser = vi.fn(async (_sessionId: string, path?: string) => ({
      sessionId: "browser-1",
      path: path ?? "C:\\",
      entries: path === "C:\\"
        ? [{ name: "manga", path: "C:\\manga", kind: "directory" as const, readerSupported: false }]
        : path === "C:\\manga"
          ? [{ name: "260701", path: "C:\\manga\\260701", kind: "directory" as const, readerSupported: false }]
          : path === "C:\\manga\\260701"
            ? [
              { name: "luluka", path: "C:\\manga\\260701\\luluka", kind: "directory" as const, readerSupported: false },
              { name: "other", path: "C:\\manga\\260701\\other", kind: "directory" as const, readerSupported: false },
            ]
            : [],
      generation: 1,
      cacheHit: false,
      excludedPaths: [],
    }))
    const client = { treeDirectoryBrowser } as unknown as ReaderHttpClient

    render(
      <FolderBreadcrumbColumns
        client={client}
        sessionId="browser-1"
        rootPath={"C:\\"}
        rootName="C:"
        activePath={["C:\\manga", "C:\\manga\\260701", "C:\\manga\\260701\\luluka"]}
        currentPath={"C:\\manga\\260701\\luluka"}
        disabled={false}
        onNavigate={onNavigate}
      />,
    )

    expect(screen.getByRole("tree", { name: "目录列导航" })).toBeTruthy()
    await waitFor(() => expect(treeDirectoryBrowser).toHaveBeenCalledTimes(4))
    expect(document.querySelector("[data-depth='0'][data-breadcrumb-column-collapsed='true']")).toBeTruthy()
    expect(document.querySelector("[data-depth='1'][data-breadcrumb-column-collapsed='true']")).toBeTruthy()
    expect(document.querySelector("[data-depth='2'][data-breadcrumb-column-collapsed='true']")).toBeNull()
    expect(screen.getByRole("treeitem", { name: "manga" }).getAttribute("aria-selected")).toBe("true")
    expect(screen.getByRole("treeitem", { name: "260701" }).getAttribute("aria-selected")).toBe("true")

    const next = await screen.findByTitle("C:\\manga\\260701\\other")
    fireEvent.click(next)
    expect(onNavigate).toHaveBeenCalledWith("C:\\manga\\260701\\other")
    expect(next.getAttribute("role")).toBe("treeitem")
    expect(next.getAttribute("aria-level")).toBe("4")
  })

  it("[neoview.folder.breadcrumb-columns] keeps keyboard selection in the open-source roving tree model", async () => {
    const onNavigate = vi.fn()
    const client = {
      treeDirectoryBrowser: vi.fn(async (_sessionId: string, path?: string) => ({
        sessionId: "browser-1",
        path: path ?? "C:\\",
        entries: [
          { name: "alpha", path: "C:\\alpha", kind: "directory" as const, readerSupported: false },
          { name: "beta", path: "C:\\beta", kind: "directory" as const, readerSupported: false },
        ],
        generation: 1,
        cacheHit: false,
        excludedPaths: [],
      })),
    } as unknown as ReaderHttpClient

    render(
      <FolderBreadcrumbColumns
        client={client}
        sessionId="browser-1"
        rootPath={"C:\\"}
        rootName="C:"
        activePath={[]}
        currentPath={"C:\\"}
        disabled={false}
        onNavigate={onNavigate}
      />,
    )

    const alpha = await screen.findByTitle("C:\\alpha")
    const beta = screen.getByTitle("C:\\beta")
    expect(screen.getAllByTitle("C:\\").find((element) => element.getAttribute("role") === "treeitem")?.getAttribute("tabindex")).toBe("0")
    expect(alpha.getAttribute("tabindex")).toBe("-1")
    expect(beta.getAttribute("tabindex")).toBe("-1")
    alpha.focus()
    fireEvent.keyDown(alpha, { key: "ArrowDown" })
    expect(document.activeElement).toBe(beta)
    fireEvent.keyDown(beta, { key: "Enter" })
    expect(onNavigate).toHaveBeenCalledWith("C:\\beta")
  })

  it("[neoview.folder.tree-cross-volume] navigates from the current E drive to a normalized D drive root", async () => {
    const onNavigate = vi.fn()
    const client = {
      listDirectoryRoots: vi.fn(async () => [
        { path: "D:", label: "Data (D:)", kind: "fixed" as const, available: true },
        { path: "E:\\", label: "BOX (E:)", kind: "fixed" as const, available: true },
      ]),
      treeDirectoryBrowser: vi.fn(async (_sessionId: string, path?: string) => ({
        sessionId: "browser-1",
        path: path ?? "E:\\",
        entries: [],
        generation: 1,
        cacheHit: false,
        excludedPaths: [],
      })),
    } as unknown as ReaderHttpClient

    render(
      <FolderBreadcrumbColumns
        client={client}
        sessionId="browser-1"
        rootPath="E:\\"
        rootName="E:"
        activePath={["E:\\library"]}
        currentPath="E:\\library"
        disabled={false}
        onNavigate={onNavigate}
      />,
    )

    fireEvent.click(await screen.findByTitle("D:\\"))
    expect(onNavigate).toHaveBeenCalledWith("D:\\")
  })
})
