import { expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"

import type { ReaderHttpClient, ReaderRuntimeConfigDto, ReaderSessionDto } from "../adapters/reader-http-client"
import { ReaderApp } from "./ReaderApp"

test("[neoview.workspace.startup-mode-gui] renders swimlane before runtime config resolves", async () => {
  const config = vi.fn(() => new Promise<ReaderRuntimeConfigDto>(() => undefined))
  const client = { config } as unknown as ReaderHttpClient

  await render(
    <div style={{ width: 1200, height: 800 }}>
      <ReaderApp sessionScopeId="browser-startup-swimlane" client={client} />
    </div>,
  )

  expect(config).toHaveBeenCalledOnce()
  await expect.poll(() => document.querySelector('[data-neoview-workspace-mode="swimlane"]')).not.toBeNull()
  await expect.poll(() => document.querySelector('[data-reader-workspace-loading="true"]')).toBeNull()
  await expect.element(page.getByRole("button", { name: "四边栏模式" })).toBeVisible()
})

test("[neoview.workspace.startup-mode-gui] keeps the fallback swimlane usable when runtime config hangs", async () => {
  const opened = readerSession()
  const open = vi.fn(async () => opened)
  const client = {
    config: vi.fn(() => new Promise<ReaderRuntimeConfigDto>(() => undefined)),
    open,
    close: vi.fn(async () => undefined),
  } as unknown as ReaderHttpClient

  await render(
    <div style={{ width: 1200, height: 800 }}>
      <ReaderApp sessionScopeId="browser-startup-swimlane-open" initialPath="D:/books/demo.cbz" client={client} />
    </div>,
  )

  await page.getByRole("button", { name: "打开书籍" }).click()

  await expect.poll(() => open).toHaveBeenCalledOnce()
  await expect.element(page.getByRole("img", { name: "001.jpg" })).toBeVisible()
  expect(document.querySelector('[data-neoview-workspace-mode="swimlane"]')).not.toBeNull()
  expect(document.querySelector('[data-reader-workspace-loading="true"]')).toBeNull()
})

function readerSession(): ReaderSessionDto {
  return {
    sessionId: "reader-browser-1",
    book: { id: "book-browser-1", displayName: "demo.cbz", pageCount: 1 },
    frame: {
      generation: 0,
      anchorPageIndex: 0,
      direction: "left-to-right",
      layout: { pageMode: "single", panorama: false, singleFirstPage: true, singleLastPage: true, treatWidePageAsSingle: true },
      pages: [{ pageId: "page-browser-1", pageIndex: 0, side: "single" }],
      pageCount: 1,
      atStart: true,
      atEnd: true,
    },
    visiblePages: [{
      id: "page-browser-1",
      index: 0,
      name: "001.jpg",
      mediaKind: "image",
      mimeType: "image/gif",
      byteLength: 43,
      contentVersion: "browser-v1",
      assetUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    }],
  }
}
