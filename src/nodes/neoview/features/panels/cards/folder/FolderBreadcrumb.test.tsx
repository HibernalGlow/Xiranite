import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

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
    expect(screen.getByRole("button", { name: "six" }).getAttribute("aria-current")).toBe("page")
    fireEvent.pointerDown(screen.getByRole("button", { name: "显示折叠路径" }), { button: 0, ctrlKey: false, pointerType: "mouse" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "one" }))
    expect(onNavigate).toHaveBeenCalledWith("C:\\one")
  })

  it("[neoview.folder.path-navigation] confirms Enter and cancels Escape or blur", async () => {
    const onNavigate = vi.fn()
    render(<FolderBreadcrumb path={"C:\\books"} onNavigate={onNavigate} />)

    fireEvent.click(screen.getByRole("button", { name: "编辑路径" }))
    const input = await screen.findByRole("textbox", { name: "浏览路径" })
    fireEvent.change(input, { target: { value: "D:/library" } })
    fireEvent.submit(input.closest("form")!)
    expect(onNavigate).toHaveBeenCalledWith("D:\\library")

    fireEvent.click(screen.getByRole("button", { name: "编辑路径" }))
    fireEvent.keyDown(screen.getByRole("textbox", { name: "浏览路径" }), { key: "Escape" })
    expect(screen.queryByRole("textbox", { name: "浏览路径" })).toBeNull()

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole("button", { name: "编辑路径" }))
    fireEvent.blur(screen.getByRole("textbox", { name: "浏览路径" }))
    act(() => vi.advanceTimersByTime(151))
    expect(screen.queryByRole("textbox", { name: "浏览路径" })).toBeNull()
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it("[neoview.folder.path-navigation] copies the authoritative current path", async () => {
    const onCopyPath = vi.fn(async () => undefined)
    render(<FolderBreadcrumb path={"C:\\books"} onNavigate={vi.fn()} onCopyPath={onCopyPath} />)
    fireEvent.click(screen.getByRole("button", { name: "复制当前路径" }))
    await waitFor(() => expect(onCopyPath).toHaveBeenCalledWith("C:\\books"))
    expect(screen.getByRole("status").textContent).toBe("已复制当前路径")
  })
})
