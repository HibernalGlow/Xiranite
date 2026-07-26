import { expect, test, vi } from "vitest"
import { render } from "vitest-browser-react"
import { DEFAULT_READER_LAYOUT, DEFAULT_READER_PRESENTATION, ReaderSlideshow } from "@xiranite/node-neoview/ui-core"

import { ReaderViewToolbar } from "./ReaderViewToolbar"

test("centers primary Reader controls below the large-screen breakpoint", async () => {
  await render(
    <div data-testid="reader-toolbar-host" style={{ width: 900 }}>
      <ReaderViewToolbar
        layout={DEFAULT_READER_LAYOUT}
        direction="left-to-right"
        presentation={DEFAULT_READER_PRESENTATION}
        onChange={vi.fn()}
        onLayoutChange={vi.fn()}
        onDirectionChange={vi.fn()}
        slideshow={createSlideshow()}
        onSlideshowChange={vi.fn()}
      />
    </div>,
  )

  const row = document.querySelector<HTMLElement>('[data-reader-toolbar-row="primary"]')!
  const buttons = Array.from(row.querySelectorAll<HTMLButtonElement>("button"))
  await expect.poll(() => row.getBoundingClientRect().width).toBe(900)

  const rowRect = row.getBoundingClientRect()
  const firstButtonRect = buttons[0]!.getBoundingClientRect()
  const lastButtonRect = buttons.at(-1)!.getBoundingClientRect()
  const controlsCenter = (firstButtonRect.left + lastButtonRect.right) / 2
  const rowCenter = rowRect.left + rowRect.width / 2

  expect(controlsCenter).toBeCloseTo(rowCenter, 1)
})

function createSlideshow(): ReaderSlideshow {
  return new ReaderSlideshow({
    readPosition: () => ({ pageCount: 1, currentPageIndex: 0, atEnd: true }),
    nextPage: vi.fn(async () => true),
    goToPage: vi.fn(async () => true),
  })
}
