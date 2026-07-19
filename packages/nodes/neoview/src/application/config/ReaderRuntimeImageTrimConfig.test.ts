import { describe, expect, it } from "vitest"

import { DEFAULT_READER_IMAGE_TRIM } from "../image-trim/ReaderImageTrim.js"
import {
  parseNeoviewImageTrimPatch,
  parseNeoviewRuntimeConfig,
} from "./ReaderRuntimeConfig.js"

describe("ReaderRuntimeImageTrimConfig", () => {
  it("[neoview.image-trim.legacy-import] normalizes the legacy view aliases", () => {
    expect(parseNeoviewRuntimeConfig({ view: { image_trim: { enabled: true, top: 12.5, link_vertical: true, auto_trim_threshold: 30 } } }).imageTrim).toMatchObject({
      enabled: true,
      top: 12.5,
      linkVertical: true,
      autoTrimThreshold: 30,
    })
  })

  it("[neoview.image-trim.patch] [neoview.image-trim.persistence] emits canonical snake_case TOML", () => {
    expect(parseNeoviewImageTrimPatch({ imageTrim: { enabled: true, top: 10.5, linkVertical: true, autoTrimTarget: "black" } })).toEqual({
      patch: { imageTrim: { enabled: true, top: 10.5, linkVertical: true, autoTrimTarget: "black" } },
      tomlPatch: { view: { image_trim: { enabled: true, top: 10.5, link_vertical: true, auto_trim_target: "black" } } },
    })
  })

  it("[neoview.image-trim.transport-linked] projects linked edges before emitting canonical TOML", () => {
    const current = {
      ...DEFAULT_READER_IMAGE_TRIM,
      top: 10,
      bottom: 20,
      left: 5,
      right: 15,
    }
    expect(parseNeoviewImageTrimPatch({ imageTrim: { linkVertical: true, linkHorizontal: true } }, current)).toEqual({
      patch: { imageTrim: { ...current, top: 20, bottom: 20, left: 15, right: 15, linkVertical: true, linkHorizontal: true } },
      tomlPatch: { view: { image_trim: {
        enabled: false,
        top: 20,
        bottom: 20,
        left: 15,
        right: 15,
        link_vertical: true,
        link_horizontal: true,
        auto_trim_threshold: 30,
        auto_trim_target: "auto",
      } } },
    })
  })

  it("[neoview.image-trim.reset] emits one exclusive default reset", () => {
    expect(parseNeoviewImageTrimPatch({ imageTrim: { reset: "defaults" } })).toEqual({
      patch: { imageTrim: { reset: "defaults" } },
      tomlPatch: { view: { image_trim: { enabled: false, top: 0, bottom: 0, left: 0, right: 0, link_vertical: false, link_horizontal: false, auto_trim_threshold: 30, auto_trim_target: "auto" } } },
    })
    expect(() => parseNeoviewImageTrimPatch({ imageTrim: { reset: "defaults", top: 1 } })).toThrow()
  })
})
