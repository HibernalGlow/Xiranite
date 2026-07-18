import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ContextMenuProvider } from "@/components/context-menu"
import type { ReaderRecentDto } from "../../../../adapters/reader-http-client"
import HistoryContextActions, { buildHistoryContextMenuItems } from "./HistoryContextActions"

const item = {
  bookId: "history-one",
  displayName: "Demo.cbz",
  source: { kind: "path", path: "D:/library/Demo.cbz" },
  pageIndex: 2,
  pageCount: 20,
  updatedAt: "2026-07-18T00:00:00.000Z",
} as ReaderRecentDto

describe("HistoryContextActions", () => {
  it("[neoview.history.context-actions] preserves the legacy file-action hierarchy", () => {
    const actions = buildHistoryContextMenuItems(item, {
      disabled: false,
      pending: false,
      canOpen: true,
      canCopyText: true,
      canOpenSystem: true,
      canReveal: true,
      canBookmark: true,
      onAction: vi.fn(),
    })

    expect(actions.map((action) => action.type === "separator" ? "separator" : action.id)).toEqual([
      "neoview-history-open", "neoview-history-system-open", "neoview-history-reveal", "separator",
      "neoview-history-copy-path", "neoview-history-copy-name", "neoview-history-reload-thumbnail", "neoview-history-add-bookmark",
      "separator", "neoview-history-remove", "separator", "neoview-history-entry-name",
    ])
    expect(actions.find((action) => action.id === "neoview-history-remove")).toMatchObject({ destructive: true, confirm: { confirmLabel: "移除历史" } })
  })

  it("registers the History scope with the global context-menu provider", async () => {
    render(
      <ContextMenuProvider>
        <HistoryContextActions client={{} as never} disabled={false} items={[item]} onReloadThumbnail={vi.fn()} onRemove={vi.fn()} onChanged={vi.fn()} />
        <button type="button" data-context-menu="neoview-history-entry" data-history-context-id={item.bookId}>target</button>
      </ContextMenuProvider>,
    )
    await screen.findByText("历史记录文件操作已就绪")
    fireEvent.contextMenu(screen.getByRole("button", { name: "target" }))
    expect(await screen.findByRole("menuitem", { name: "复制路径" })).toBeDefined()
  })
})
