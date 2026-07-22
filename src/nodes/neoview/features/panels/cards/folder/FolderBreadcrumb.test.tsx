import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderHttpClient } from "../../../../adapters/reader-http-client"
import {
  FolderBreadcrumb,
  normalizeEditableFolderPath,
  parseFolderPath,
  visibleFolderBreadcrumbItems,
} from "./FolderBreadcrumb"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("FolderBreadcrumb", () => {
  it("[neoview.folder.path-navigation] parses Windows drives, UNC shares and POSIX roots", () => {
    expect(parseFolderPath("C:/books/series")).toEqual([
      { name: "C:", path: "C:\\", root: true },
      { name: "books", path: "C:\\books", root: false },
      { name: "series", path: "C:\\books\\series", root: false },
    ])
    expect(parseFolderPath("\\\\server\\share\\books")).toEqual([
      { name: "\\\\server\\share", path: "\\\\server\\share\\", root: true },
      { name: "books", path: "\\\\server\\share\\books", root: false },
    ])
    expect(parseFolderPath("/home/reader")).toEqual([
      { name: "/", path: "/", root: true },
      { name: "home", path: "/home", root: false },
      { name: "reader", path: "/home/reader", root: false },
    ])
    expect(normalizeEditableFolderPath("C:/books")).toBe("C:\\books")
    expect(normalizeEditableFolderPath("C:")).toBe("C:\\")
  })

  it("[neoview.folder.path-navigation] keeps root and tail segments while collapsing the middle", async () => {
    const onNavigate = vi.fn()
    const items = parseFolderPath("C:\\one\\two\\three\\four\\five\\six")
    expect(visibleFolderBreadcrumbItems(items, 3)).toEqual({
      collapsed: items.slice(1, 5),
      visible: [items[0], items[5], items[6]],
    })

    render(<FolderBreadcrumb path={"C:\\one\\two\\three\\four\\five\\six"} onNavigate={onNavigate} />)
    expect(screen.getByRole("navigation", { name: "当前目录" }).className).toContain("overflow-x-auto")
    expect(screen.getByRole("button", { name: "six" }).getAttribute("aria-current")).toBe("page")
    fireEvent.pointerDown(screen.getByRole("button", { name: "显示折叠路径" }), { button: 0, ctrlKey: false, pointerType: "mouse" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "one" }))
    expect(onNavigate).toHaveBeenCalledWith("C:\\one")
  })

  it("[neoview.folder.path-navigation] starts editing on current-segment click and confirms Enter / cancels Escape or blur", async () => {
    const onNavigate = vi.fn()
    render(<FolderBreadcrumb path={"C:\\books"} onNavigate={onNavigate} />)

    // Click the current breadcrumb segment (Explorer-style) instead of a dedicated edit button.
    fireEvent.click(screen.getByRole("button", { name: "books" }))
    const input = await screen.findByRole("textbox", { name: "浏览路径" })
    fireEvent.change(input, { target: { value: "D:/library" } })
    fireEvent.submit(input.closest("form")!)
    expect(onNavigate).toHaveBeenCalledWith("D:\\library")

    fireEvent.click(screen.getByRole("button", { name: "books" }))
    fireEvent.keyDown(screen.getByRole("textbox", { name: "浏览路径" }), { key: "Escape" })
    expect(screen.queryByRole("textbox", { name: "浏览路径" })).toBeNull()

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole("button", { name: "books" }))
    fireEvent.blur(screen.getByRole("textbox", { name: "浏览路径" }))
    act(() => vi.advanceTimersByTime(151))
    expect(screen.queryByRole("textbox", { name: "浏览路径" })).toBeNull()
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it("[neoview.folder.path-navigation] starts editing when clicking empty breadcrumb padding", async () => {
    render(<FolderBreadcrumb path={"C:\\books"} onNavigate={vi.fn()} />)
    const spacer = document.querySelector("[data-breadcrumb-edit-hit='true'].flex-1")
    expect(spacer).toBeTruthy()
    fireEvent.click(spacer!)
    expect(await screen.findByRole("textbox", { name: "浏览路径" })).toBeTruthy()
  })

  it("[neoview.folder.path-navigation] copies the authoritative current path from the actions menu", async () => {
    const onCopyPath = vi.fn(async () => undefined)
    render(<FolderBreadcrumb path={"C:\\books"} onNavigate={vi.fn()} onCopyPath={onCopyPath} />)
    fireEvent.pointerDown(screen.getByRole("button", { name: "路径操作" }), { button: 0, pointerType: "mouse" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "复制当前路径" }))
    await waitFor(() => expect(onCopyPath).toHaveBeenCalledWith("C:\\books"))
    expect(screen.getByRole("status").textContent).toBe("已复制当前路径")
  })

  it("[neoview.folder.breadcrumb-columns-modes] keeps path actions in one menu and switches column hosts", async () => {
    const treeDirectoryBrowser = vi.fn(async (_sessionId: string, path?: string) => ({
      sessionId: "browser-1",
      path: path ?? "C:\\",
      entries: [{ name: "manga", path: "C:\\manga", kind: "directory" as const, readerSupported: false }],
      generation: 1,
      cacheHit: false,
      excludedPaths: [],
    }))
    const onCreateTab = vi.fn()

    render(<FolderBreadcrumb
      path={"C:\\manga"}
      client={{ treeDirectoryBrowser } as unknown as ReaderHttpClient}
      sessionId="browser-1"
      canCreateTab
      onCreateTab={onCreateTab}
      onNavigate={vi.fn()}
      onCopyPath={vi.fn()}
    />)

    expect(document.querySelector("[data-breadcrumb-action-pad]")).toBeNull()
    expect(screen.queryByRole("button", { name: "编辑路径" })).toBeNull()
    expect(screen.queryByRole("button", { name: "复制当前路径" })).toBeNull()
    expect(screen.queryByRole("button", { name: "新建文件夹标签" })).toBeNull()
    expect(screen.getByRole("button", { name: "路径操作" })).toBeTruthy()

    fireEvent.pointerDown(screen.getByRole("button", { name: "路径操作" }), { button: 0, pointerType: "mouse" })
    expect(await screen.findByRole("menuitem", { name: "新建文件夹标签" })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: "展开目录列" })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: "编辑路径" })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: "复制当前路径" })).toBeTruthy()
    expect(screen.getByRole("menuitemradio", { name: "下拉展开" })).toBeTruthy()
    expect(screen.getByRole("menuitemradio", { name: "浮动窗口" })).toBeTruthy()

    fireEvent.click(screen.getByRole("menuitem", { name: "展开目录列" }))
    await waitFor(() => expect(document.querySelector("[data-breadcrumb-columns-inline='true']")).toBeTruthy())
    expect(await screen.findByRole("tree", { name: "目录列导航" })).toBeTruthy()

    fireEvent.pointerDown(screen.getByRole("button", { name: "路径操作" }), { button: 0, pointerType: "mouse" })
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "浮动窗口" }))
    await waitFor(() => expect(document.querySelector("[data-breadcrumb-columns-inline='true']")).toBeNull())
    expect(await screen.findByRole("tree", { name: "目录列导航" })).toBeTruthy()

    fireEvent.pointerDown(screen.getByRole("button", { name: "路径操作" }), { button: 0, pointerType: "mouse" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "新建文件夹标签" }))
    expect(onCreateTab).toHaveBeenCalledOnce()
  })
})
