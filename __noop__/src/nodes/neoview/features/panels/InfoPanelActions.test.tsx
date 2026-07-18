import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ContextMenuProvider } from "@/components/context-menu"
import type { ReaderHttpClient, ReaderMetadataDto, ReaderSessionDto } from "../../adapters/reader-http-client"
import { InfoPanelActions } from "./InfoPanelActions"
import type { ReaderPanelContext } from "./registry"

afterEach(cleanup)

describe("InfoPanelActions", () => {
  it("[neoview.book-information.panel-actions] copies and reveals the canonical book source from both action surfaces", async () => {
    const copyText = vi.fn(async () => undefined)
    const revealPath = vi.fn(async () => undefined)
    const context = panelContext(copyText, revealPath)
    const user = userEvent.setup()
    render(
      <ContextMenuProvider>
        <div data-context-menu="neoview-info" data-testid="info-panel"><InfoPanelActions context={context} /></div>
      </ContextMenuProvider>,
    )

    await user.click(screen.getByRole("button", { name: "信息面板操作" }))
    await user.click(await screen.findByText("复制路径"))
    expect(copyText).toHaveBeenCalledWith("D:/books/demo.cbz")
    expect((await screen.findByRole("status")).textContent).toContain("已复制书籍路径")

    fireEvent.contextMenu(screen.getByTestId("info-panel"), { clientX: 20, clientY: 30 })
    await user.click(await screen.findByText("在资源管理器中打开"))
    expect(revealPath).toHaveBeenCalledWith("D:/books/demo.cbz", expect.any(AbortSignal))
    expect((await screen.findByRole("status")).textContent).toContain("已在文件管理器中定位")
  })

  it("[neoview.book-information.panel-actions-disabled] disables unavailable host actions", async () => {
    const context = panelContext()
    const user = userEvent.setup()
    render(<ContextMenuProvider><InfoPanelActions context={context} /></ContextMenuProvider>)
    await user.click(screen.getByRole("button", { name: "信息面板操作" }))
    await waitFor(() => expect(screen.getByText("复制路径").closest("[data-disabled]")).toBeTruthy())
    expect(screen.getByText("在资源管理器中打开").closest("[data-disabled]")).toBeTruthy()
  })
})

function panelContext(copyText?: (text: string) => Promise<void>, revealPath?: (path: string, signal?: AbortSignal) => Promise<void>): ReaderPanelContext {
  const metadata = vi.fn(async () => metadataDto())
  return {
    client: clientWith(metadata),
    session: session(),
    disabled: false,
    onGoTo: vi.fn(),
    systemActions: { copyText, revealPath },
  }
}

function clientWith(metadata: NonNullable<ReaderHttpClient["metadata"]>): ReaderHttpClient {
  return {
    config: vi.fn(), updateSidebarLayout: vi.fn(), updateCardLayout: vi.fn(), updateBoardLayout: vi.fn(), updateViewDefaults: vi.fn(),
    updateSlideshow: vi.fn(), open: vi.fn(), listPages: vi.fn(), navigate: vi.fn(), goTo: vi.fn(), updateSessionOptions: vi.fn(), close: vi.fn(), metadata,
  }
}

function session(): ReaderSessionDto {
  return {
    sessionId: "reader-1",
    book: { id: "book-1", displayName: "demo.cbz", pageCount: 1 },
    frame: { generation: 1, anchorPageIndex: 0, direction: "left-to-right", layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true }, pages: [], pageCount: 1, atStart: true, atEnd: true },
    visiblePages: [],
  }
}

function metadataDto(): ReaderMetadataDto {
  return {
    book: { bookId: "book-1", displayName: "demo.cbz", sourceKind: "archive", sourcePath: "D:/books/demo.cbz", pageCount: 1, currentPage: 1, progressPercent: 100 },
  }
}
