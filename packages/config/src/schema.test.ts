import { describe, expect, test } from "vitest"
import {
  getAppConfig,
  getWebview2Config,
  getNodeConfig,
  stripBom,
  updateAppConfig,
  updateWebview2Config,
  updateNodeConfig,
} from "./index.js"

describe("getNodeConfig / updateNodeConfig", () => {
  test("getNodeConfig returns node section", () => {
    const config = { nodes: { linku: { enabled: true } } }
    expect(getNodeConfig(config, "linku")).toEqual({ enabled: true })
    expect(getNodeConfig(config, "missing")).toBeUndefined()
  })

  test("updateNodeConfig merges object node sections immutably", () => {
    const original = { nodes: { linku: { enabled: false, links: [{ source: "s", target: "t" }] } } }
    const updated = updateNodeConfig(original, "linku", { enabled: true })
    expect(updated.nodes?.linku).toEqual({ enabled: true, links: [{ source: "s", target: "t" }] })
    expect(original.nodes?.linku).toEqual({ enabled: false, links: [{ source: "s", target: "t" }] })
  })
})

describe("getAppConfig / updateAppConfig", () => {
  test("getAppConfig returns an app section", () => {
    const config = { app: { ui: { theme: "wuling" } } }
    expect(getAppConfig(config, "ui")).toEqual({ theme: "wuling" })
    expect(getAppConfig(config, "missing")).toBeUndefined()
  })

  test("updateAppConfig merges app sections immutably", () => {
    const original = { app: { ui: { theme: "spatial", colorMode: "light" } } }
    const updated = updateAppConfig(original, "ui", { colorMode: "dark" })
    expect(updated.app?.ui).toEqual({ theme: "spatial", colorMode: "dark" })
    expect(original.app?.ui).toEqual({ theme: "spatial", colorMode: "light" })
  })
})

describe("getWebview2Config / updateWebview2Config", () => {
  test("reads and replaces the top-level WebView2 startup config", () => {
    const original = {
      workspace: { default: "ws" },
      webview2: {
        features: ["JXLImageFormat"],
        switches: ["--enable-zero-copy"],
      },
    }
    expect(getWebview2Config(original)).toEqual(original.webview2)

    const updated = updateWebview2Config(original, {
      features: ["CanvasOopRasterization", "CanvasOopRasterization"],
      switches: ["--enable-gpu-rasterization"],
    })
    expect(updated.webview2).toEqual({
      features: ["CanvasOopRasterization"],
      switches: ["--enable-gpu-rasterization"],
    })
    expect(original.webview2.features).toEqual(["JXLImageFormat"])
  })
})

describe("stripBom", () => {
  test("strips BOM prefix", () => {
    expect(stripBom("\uFEFFcontent")).toBe("content")
    expect(stripBom("content")).toBe("content")
  })
})
