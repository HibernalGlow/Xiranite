import { describe, expect, it } from "vitest"

import {
  parseNeoviewInfoOverlayPatch,
  parseNeoviewRuntimeConfig,
} from "./ReaderRuntimeConfig.js"

describe("ReaderRuntimeInfoOverlayConfig", () => {
  it("[neoview.info-overlay.legacy-import] reads camelCase and canonical view aliases", () => {
    expect(parseNeoviewRuntimeConfig({ view: { infoOverlay: { enabled: true, opacity: 0.7, showBorder: true, width: 480, height: "auto" } } }).infoOverlay).toEqual({
      enabled: true,
      opacity: 0.7,
      showBorder: true,
      width: 480,
    })
  })

  it("[neoview.info-overlay.patch] emits canonical TOML and auto dimensions", () => {
    expect(parseNeoviewInfoOverlayPatch({ infoOverlay: { enabled: true, width: null, height: 56 } })).toEqual({
      patch: { infoOverlay: { enabled: true, width: null, height: 56 } },
      tomlPatch: { view: { info_overlay: { enabled: true, width: "auto", height: 56 } } },
    })
  })

  it("[neoview.info-overlay.reset] emits an exclusive default reset", () => {
    expect(parseNeoviewInfoOverlayPatch({ infoOverlay: { reset: "defaults" } })).toEqual({
      patch: { infoOverlay: { reset: "defaults" } },
      tomlPatch: { view: { info_overlay: { enabled: false, opacity: 0.85, show_border: false } } },
    })
    expect(() => parseNeoviewInfoOverlayPatch({ infoOverlay: { reset: "defaults", enabled: true } })).toThrow()
  })
})
