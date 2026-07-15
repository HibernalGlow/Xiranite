import { describe, expect, it } from "vitest"
import { parseNeoviewRuntimeConfig, parseNeoviewSidebarLayoutPatch } from "./ReaderRuntimeConfig.js"

describe("parseNeoviewRuntimeConfig", () => {
  it("[neoview.settings.runtime] maps schema v1 reader defaults", () => {
    expect(parseNeoviewRuntimeConfig({
      schema_version: 1,
      reader: {
        reading_direction: "right-to-left",
        double_page_view: true,
        tail_overflow_behavior: "seamless-loop",
      },
    }).sessionOptions).toEqual({
      direction: "right-to-left",
      layout: {
        pageMode: "double",
        panorama: false,
        singleFirstPage: true,
        singleLastPage: true,
        treatWidePageAsSingle: true,
      },
      tailOverflow: "seamless-loop",
    })
  })

  it("accepts the nested v1 compatibility shape and legacy tail aliases", () => {
    expect(parseNeoviewRuntimeConfig({
      reader: {
        book: {
          reading_direction: "left-to-right",
          double_page_view: false,
          tail_overflow_behavior: "nextBook",
        },
      },
    }).sessionOptions).toMatchObject({
      direction: "left-to-right",
      layout: { pageMode: "single" },
      tailOverflow: "next-book",
    })
  })

  it("rejects unsupported schema versions and invalid executable settings", () => {
    expect(() => parseNeoviewRuntimeConfig({ schema_version: 2 })).toThrow("schema_version must be 1")
    expect(() => parseNeoviewRuntimeConfig({ reader: { reading_direction: "top-to-bottom" } })).toThrow("reading_direction")
    expect(() => parseNeoviewRuntimeConfig({ reader: { double_page_view: "yes" } })).toThrow("double_page_view")
    expect(() => parseNeoviewRuntimeConfig({ reader: { tail_overflow_behavior: "delete-book" } })).toThrow("tail_overflow_behavior")
  })

  it("returns empty defaults when no NeoView section exists", () => {
    expect(parseNeoviewRuntimeConfig(undefined)).toMatchObject({
      schemaVersion: 1,
      sessionOptions: {},
      shellOptions: {
        showDelayMs: 0,
        edges: { left: { pinned: true, triggerSize: 32 }, right: { initialVisible: false } },
        sidebars: { left: { width: 320 }, right: { width: 280 } },
      },
    })
  })

  it("[neoview.settings.shell] normalizes legacy panel settings into bounded shell options", () => {
    const { shellOptions } = parseNeoviewRuntimeConfig({
      panels: {
        left_sidebar_visible: true,
        right_sidebar_visible: false,
        bottom_panel_visible: true,
        auto_hide_toolbar: false,
        sidebar_opacity: 73,
        sidebar_blur: 7,
        hover_areas: { top_trigger_height: 4, bottom_trigger_height: 5, left_trigger_width: 6, right_trigger_width: 7 },
        auto_hide_timing: { show_delay_sec: 0.125, hide_delay_sec: 0.75 },
        sidebars: {
          left: { width: 420, pinned: false, open: false, height: "custom", custom_height: 72, vertical_align: 40, horizontal_position: 15 },
          right: { width: 260, height: "2/3" },
        },
      },
    })
    expect(shellOptions).toMatchObject({
      showDelayMs: 125,
      hideDelayMs: 750,
      opacity: { sidebar: 73 },
      blur: { sidebar: 7 },
      edges: {
        top: { initialVisible: true, pinned: true, triggerSize: 4 },
        right: { enabled: false, triggerSize: 7 },
        bottom: { enabled: true, initialVisible: true, triggerSize: 5 },
        left: { enabled: true, initialVisible: false, pinned: false, triggerSize: 6 },
      },
      sidebars: {
        left: { width: 420, height: "custom", customHeight: 72, verticalAlign: 40, horizontalPosition: 15 },
        right: { width: 260, height: "two-thirds" },
      },
    })
  })

  it("rejects shell values outside safe rendering and timer limits", () => {
    expect(() => parseNeoviewRuntimeConfig({ panels: { hover_areas: { top_trigger_height: 0 } } })).toThrow("top trigger")
    expect(() => parseNeoviewRuntimeConfig({ panels: { auto_hide_timing: { hide_delay_sec: 6 } } })).toThrow("hide_delay_sec")
    expect(() => parseNeoviewRuntimeConfig({ panels: { sidebars: { left: { width: 1000 } } } })).toThrow("left.width")
  })

  it("[neoview.settings.shell-patch] validates and converts sidebar patches to TOML shape", () => {
    expect(parseNeoviewSidebarLayoutPatch({
      side: "right",
      width: 412,
      height: "two-thirds",
      customHeight: 72,
      verticalAlign: 35,
      horizontalPosition: 18,
    })).toEqual({
      patch: { side: "right", width: 412, height: "two-thirds", customHeight: 72, verticalAlign: 35, horizontalPosition: 18 },
      tomlPatch: { panels: { sidebars: { right: { width: 412, height: "2/3", custom_height: 72, vertical_align: 35, horizontal_position: 18 } } } },
    })
    expect(() => parseNeoviewSidebarLayoutPatch({ side: "left" })).toThrow("at least one")
    expect(() => parseNeoviewSidebarLayoutPatch({ side: "left", width: 199 })).toThrow("width")
    expect(() => parseNeoviewSidebarLayoutPatch({ side: "left", width: 320, token: "no" })).toThrow("unsupported")
  })
})
