import { describe, expect, it } from "vitest"

import type { ReaderFolderViewConfig } from "../../adapters/reader-http-client"
import {
  applyReaderFilePresentationOverridePatch,
  legacyHistoryViewOverrides,
  resolveReaderFilePresentation,
} from "./readerFilePresentation"

const folderView = {
  viewMode: "cover-grid",
  contentWidthPercent: 44,
  thumbnailWidthPercent: 32,
  bannerWidthPercent: 60,
} as ReaderFolderViewConfig

describe("readerFilePresentation", () => {
  it("[neoview.library-view.inheritance] inherits every unspecified File presentation field", () => {
    expect(resolveReaderFilePresentation(folderView, {})).toEqual({
      viewMode: "cover-grid",
      contentWidthPercent: 44,
      thumbnailWidthPercent: 32,
      bannerWidthPercent: 60,
    })
    expect(resolveReaderFilePresentation(folderView, { thumbnailWidthPercent: 48 })).toEqual({
      viewMode: "cover-grid",
      contentWidthPercent: 44,
      thumbnailWidthPercent: 48,
      bannerWidthPercent: 60,
    })
  })

  it("[neoview.library-view.reset-inheritance] removes only fields explicitly reset to null", () => {
    expect(applyReaderFilePresentationOverridePatch(
      { viewMode: "mosaic-list", thumbnailWidthPercent: 48 },
      { thumbnailWidthPercent: null },
    )).toEqual({ viewMode: "mosaic-list" })
  })

  it("[neoview.library-view.legacy-history] keeps old History view_mode readable", () => {
    expect(legacyHistoryViewOverrides({ viewMode: "thumbnail" })).toEqual({ viewMode: "cover-grid" })
    expect(legacyHistoryViewOverrides({ viewMode: "thumbnail", viewOverrides: {} })).toEqual({})
  })
})
