import { describe, expect, it } from "vitest"

import { readerExplorerFileExtensions } from "./ReaderExplorerExtensions.js"

describe("readerExplorerFileExtensions", () => {
  it("[neoview.file.explorer-format-plan] uses configured image and video formats plus supported archive books", () => {
    expect(readerExplorerFileExtensions({
      supportedImageFormats: ["jpg", "comic-image"],
      videoFormats: ["webm", "comic-video"],
    })).toEqual(["jpg", "comic-image", "webm", "comic-video", "zip", "cbz", "rar", "cbr", "7z", "cb7", "epub"])
  })
})
