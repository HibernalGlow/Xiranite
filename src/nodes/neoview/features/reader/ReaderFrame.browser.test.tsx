import { expect, test } from "vitest"
import { render } from "vitest-browser-react"
import { DEFAULT_READER_MOUSE_CURSOR_SETTINGS, DEFAULT_READER_PRESENTATION } from "@xiranite/node-neoview/ui-core"

import type { ReaderHttpClient, ReaderPageDto } from "../../adapters/reader-http-client"
import type { ReaderVideoController } from "../video/ReaderVideoController"
import { ReaderFrame } from "./ReaderFrame"

test("[neoview.reader.frame-cursor-auto-hide] applies the legacy cursor policy to the rendered reading viewport", async () => {
  await render(
    <div style={{ height: 720, width: 960 }}>
      <ReaderFrame
        pages={[page(0)]}
        presentation={DEFAULT_READER_PRESENTATION}
        totalPages={1}
        anchorPageIndex={0}
        sessionId="cursor-browser"
        client={{} as ReaderHttpClient}
        videoController={{} as ReaderVideoController}
        mouseCursor={{ ...DEFAULT_READER_MOUSE_CURSOR_SETTINGS, hideDelay: 0, showMovementThreshold: 20 }}
        onSubtitleConfigChange={async () => undefined}
        onVideoListEnded={() => undefined}
      />
    </div>,
  )
  const viewport = document.querySelector<HTMLElement>("[data-reader-frame-viewport]")!

  viewport.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true, clientX: 10, clientY: 10 }))
  await expect.poll(() => viewport.dataset.readerCursorHidden).toBe("true")
  viewport.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 32, clientY: 10 }))
  expect(viewport.dataset.readerCursorHidden).toBeUndefined()
})

test("[neoview.reader.panorama-cursor-auto-hide] applies the same policy to the panorama viewport", async () => {
  await render(
    <div style={{ height: 720, width: 960 }}>
      <ReaderFrame
        pages={[page(0)]}
        presentation={DEFAULT_READER_PRESENTATION}
        panorama
        totalPages={1}
        anchorPageIndex={0}
        sessionId="cursor-panorama-browser"
        client={{} as ReaderHttpClient}
        videoController={{} as ReaderVideoController}
        mouseCursor={{ ...DEFAULT_READER_MOUSE_CURSOR_SETTINGS, hideDelay: 0, showMovementThreshold: 20 }}
        onSubtitleConfigChange={async () => undefined}
        onVideoListEnded={() => undefined}
      />
    </div>,
  )
  await expect.poll(() => document.querySelector("[data-reader-panorama='true']")).not.toBeNull()
  const viewport = document.querySelector<HTMLElement>("[data-reader-panorama='true']")!

  viewport.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true, clientX: 10, clientY: 10 }))
  await expect.poll(() => viewport.dataset.readerCursorHidden).toBe("true")
  viewport.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 32, clientY: 10 }))
  expect(viewport.dataset.readerCursorHidden).toBeUndefined()
})

function page(index: number): ReaderPageDto {
  return {
    id: `page-${index}`,
    index,
    name: `${String(index).padStart(3, "0")}.jpg`,
    mediaKind: "image",
    contentVersion: "v1",
    assetUrl: `https://reader.invalid/${index}.jpg`,
    dimensions: { width: 1200, height: 1800 },
  }
}
