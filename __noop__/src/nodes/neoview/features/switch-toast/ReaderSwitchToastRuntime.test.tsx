import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { DEFAULT_READER_SWITCH_TOAST } from "@xiranite/node-neoview/switch-toast"
import type { ReaderSessionDto } from "../../adapters/reader-http-client"
import { ReaderSwitchToastRuntime } from "./ReaderSwitchToastRuntime"
import { createReaderSwitchToastStore } from "./ReaderSwitchToastStore"

afterEach(cleanup)

describe("ReaderSwitchToastRuntime", () => {
  it("[neoview.switch-toast.book-runtime] [neoview.switch-toast.page-runtime] renders templates on actual session transitions", async () => {
    const port = createReaderSwitchToastStore({ persist: async (settings) => settings })
    port.hydrate({
      ...DEFAULT_READER_SWITCH_TOAST,
      enableBook: true,
      enablePage: true,
      bookTitleTemplate: "已打开 {{book.displayName}}",
      pageTitleTemplate: "第 {{page.indexDisplay}} / {{book.totalPages}} 页",
    })
    const view = render(<ReaderSwitchToastRuntime port={port} session={sessionAt(0)} sourcePath="D:/Books/Demo.cbz" />)
    expect(await screen.findByText("已打开 Demo")).toBeTruthy()
    expect(screen.getByText("路径：D:/Books/Demo.cbz")).toBeTruthy()

    view.rerender(<ReaderSwitchToastRuntime port={port} session={sessionAt(1)} sourcePath="D:/Books/Demo.cbz" />)
    expect(await screen.findByText("第 2 / 2 页")).toBeTruthy()
    expect(screen.getByText((_content, element) => element?.textContent === "1200 × 1800  2.0 KiB")).toBeTruthy()
    port.dispose()
  })

  it("[neoview.switch-toast.host-style] projects geometry, opacity and glass without a Reader session", async () => {
    const port = createReaderSwitchToastStore({ persist: async (settings) => settings })
    port.hydrate({ ...DEFAULT_READER_SWITCH_TOAST, positionX: 48, positionY: 72, opacity: 0.7, liquidGlass: true })
    const view = render(<ReaderSwitchToastRuntime port={port} sourcePath="" />)
    port.show({ title: "切换提示测试", description: "X 48px / Y 72px / 透明度 70%" })
    expect(await screen.findByText("切换提示测试")).toBeTruthy()
    const host = view.container.querySelector<HTMLElement>('[data-reader-switch-toast-host="true"]')
    expect(host?.style.left).toBe("48px")
    expect(host?.style.top).toBe("72px")
    expect(view.container.querySelector('[data-liquid-glass="true"]')).toBeTruthy()
    port.dispose()
  })
})

function sessionAt(index: number): ReaderSessionDto {
  return {
    sessionId: "session-1",
    book: { id: "book-1", displayName: "Demo", pageCount: 2 },
    frame: {
      generation: index + 1,
      anchorPageIndex: index,
      direction: "left-to-right",
      layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      pages: [{ pageId: `page-${index + 1}`, pageIndex: index, side: "single" }],
      pageCount: 2,
      atStart: index === 0,
      atEnd: index === 1,
    },
    visiblePages: [{
      id: `page-${index + 1}`,
      index,
      name: `00${index + 1}.jpg`,
      mediaKind: "image",
      mimeType: "image/jpeg",
      byteLength: 2_048,
      dimensions: { width: 1_200, height: 1_800 },
      contentVersion: "1",
      assetUrl: `http://reader.test/page-${index + 1}`,
    }],
  }
}
