import { describe, expect, it } from "vitest"

import { DEFAULT_READER_SWITCH_TOAST } from "../switch-toast/ReaderSwitchToast.js"
import {
  parseNeoviewRuntimeConfig,
  parseNeoviewSwitchToastPatch,
} from "./ReaderRuntimeConfig.js"

describe("ReaderRuntimeConfig switch toast", () => {
  it("[neoview.switch-toast.config] reads canonical snake_case and legacy camelCase aliases", () => {
    expect(parseNeoviewRuntimeConfig({ view: { switch_toast: {
      enable_book: true,
      enable_page: true,
      enable_action: true,
      position_x: 64,
      opacity: 0.75,
      book_title_template: "{{book.displayName}}",
      future_field: "preserved-on-disk",
    } } }).switchToast).toMatchObject({
      enableBook: true,
      enablePage: true,
      enableAction: true,
      positionX: 64,
      opacity: 0.75,
      bookTitleTemplate: "{{book.displayName}}",
    })
    expect(parseNeoviewRuntimeConfig({ view: {
      showBookSwitchToast: true,
      switchToast: { enablePage: true, liquidGlass: true },
    } }).switchToast).toMatchObject({ enableBook: true, enablePage: true, liquidGlass: true })
  })

  it("[neoview.switch-toast.toml] emits strict partial TOML leaves and rejects invalid input", () => {
    expect(parseNeoviewSwitchToastPatch({ switchToast: {
      enableBook: true,
      positionX: 120,
      pageTitleTemplate: "第 {{page.indexDisplay}} 页",
    } })).toEqual({
      patch: { switchToast: {
        enableBook: true,
        positionX: 120,
        pageTitleTemplate: "第 {{page.indexDisplay}} 页",
      } },
      tomlPatch: { view: { switch_toast: {
        enable_book: true,
        position_x: 120,
        page_title_template: "第 {{page.indexDisplay}} 页",
      } } },
    })
    expect(() => parseNeoviewSwitchToastPatch({ switchToast: { opacity: 1.01 } })).toThrow("opacity")
    expect(() => parseNeoviewSwitchToastPatch({ switchToast: {} })).toThrow("at least one")
    expect(() => parseNeoviewSwitchToastPatch({ switchToast: { enableBook: true }, other: true })).toThrow("unsupported")
  })

  it("[neoview.switch-toast.reset] emits one complete canonical reset", () => {
    const result = parseNeoviewSwitchToastPatch({ switchToast: { reset: "defaults" } })
    expect(result.patch).toEqual({ switchToast: { reset: "defaults" } })
    expect(result.tomlPatch).toEqual({ view: { switch_toast: {
      enable_book: DEFAULT_READER_SWITCH_TOAST.enableBook,
      enable_page: DEFAULT_READER_SWITCH_TOAST.enablePage,
      enable_action: DEFAULT_READER_SWITCH_TOAST.enableAction,
      enable_boundary_toast: DEFAULT_READER_SWITCH_TOAST.enableBoundaryToast,
      show_book_path: DEFAULT_READER_SWITCH_TOAST.showBookPath,
      show_book_page_progress: DEFAULT_READER_SWITCH_TOAST.showBookPageProgress,
      show_book_type: DEFAULT_READER_SWITCH_TOAST.showBookType,
      show_page_index: DEFAULT_READER_SWITCH_TOAST.showPageIndex,
      show_page_size: DEFAULT_READER_SWITCH_TOAST.showPageSize,
      show_page_dimensions: DEFAULT_READER_SWITCH_TOAST.showPageDimensions,
      book_title_template: DEFAULT_READER_SWITCH_TOAST.bookTitleTemplate,
      book_description_template: DEFAULT_READER_SWITCH_TOAST.bookDescriptionTemplate,
      page_title_template: DEFAULT_READER_SWITCH_TOAST.pageTitleTemplate,
      page_description_template: DEFAULT_READER_SWITCH_TOAST.pageDescriptionTemplate,
      position_x: DEFAULT_READER_SWITCH_TOAST.positionX,
      position_y: DEFAULT_READER_SWITCH_TOAST.positionY,
      opacity: DEFAULT_READER_SWITCH_TOAST.opacity,
      liquid_glass: DEFAULT_READER_SWITCH_TOAST.liquidGlass,
    } } })
    expect(() => parseNeoviewSwitchToastPatch({ switchToast: { reset: "defaults", enableBook: true } }))
      .toThrow("cannot be combined")
  })

  it("[neoview.switch-toast.resident] keeps the Card visible without a Reader session", () => {
    expect(parseNeoviewRuntimeConfig({}).shellOptions.cardLayout["switch-toast"]).toEqual({
      panelId: "control",
      visible: true,
      expanded: true,
      order: 0,
    })
  })
})
