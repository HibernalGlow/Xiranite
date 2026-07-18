import { describe, expect, it, vi } from "vitest"

import type { ReaderBookmarkDto } from "../../../../adapters/reader-http-client"
import { buildBookmarkContextMenuItems } from "./BookmarkContextActions"

const item: ReaderBookmarkDto = {
  id: "bookmark-1",
  source: { kind: "archive", path: "D:/books/example.cbz" },
  name: "example.cbz",
  kind: "file",
  starred: false,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_100_000,
  listIds: ["default"],
}

describe("BookmarkContextActions", () => {
  it("[neoview.bookmark.context-actions] preserves the legacy file action hierarchy", async () => {
    const onAction = vi.fn()
    const actions = buildBookmarkContextMenuItems(item, {
      disabled: false,
      pending: false,
      canOpen: true,
      canCopyText: true,
      canOpenSystem: true,
      canReveal: true,
      onAction,
    })

    expect(actions.map((action) => action.label).filter(Boolean)).toEqual([
      "打开",
      "用默认软件打开",
      "在资源管理器中显示",
      "复制路径",
      "复制名称",
      "重新加载缩略图",
      "收藏",
      "删除书签",
      "example.cbz",
    ])
    await actions.find((action) => action.id === "neoview-bookmark-copy-path")?.onSelect?.()
    expect(onAction).toHaveBeenCalledWith("copy-path", item)
    const remove = actions.find((action) => action.id === "neoview-bookmark-remove")
    expect(remove?.destructive).toBe(true)
    expect(remove?.confirm).toMatchObject({ confirmLabel: "删除书签" })
  })

  it("[neoview.bookmark.context-capabilities] disables unavailable host actions without hiding them", () => {
    const actions = buildBookmarkContextMenuItems({ ...item, starred: true }, {
      disabled: false,
      pending: false,
      canOpen: true,
      canCopyText: false,
      canOpenSystem: false,
      canReveal: false,
      onAction: vi.fn(),
    })

    expect(actions.find((action) => action.id === "neoview-bookmark-system-open")?.disabled).toBe(true)
    expect(actions.find((action) => action.id === "neoview-bookmark-reveal")?.disabled).toBe(true)
    expect(actions.find((action) => action.id === "neoview-bookmark-copy-name")?.disabled).toBe(true)
    expect(actions.find((action) => action.id === "neoview-bookmark-toggle-star")?.label).toBe("取消收藏")
  })
})
