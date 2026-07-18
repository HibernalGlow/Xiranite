import { describe, expect, it } from "vitest"

import {
  applyReaderSwitchToastPatch,
  DEFAULT_READER_SWITCH_TOAST,
  normalizeReaderSwitchToast,
  parseReaderSwitchToastPatch,
  renderReaderSwitchToastTemplate,
  type ReaderSwitchToastContext,
} from "./ReaderSwitchToast.js"

describe("ReaderSwitchToast", () => {
  it("[neoview.switch-toast.defaults] preserves legacy switches, templates and geometry", () => {
    expect(DEFAULT_READER_SWITCH_TOAST).toEqual({
      enableBook: false,
      enablePage: false,
      enableAction: false,
      enableBoundaryToast: true,
      showBookPath: true,
      showBookPageProgress: true,
      showBookType: false,
      showPageIndex: true,
      showPageSize: false,
      showPageDimensions: true,
      bookTitleTemplate: "\u5df2\u5207\u6362\u5230 {{book.displayName}}\uff08\u7b2c {{book.currentPageDisplay}} / {{book.totalPages}} \u9875\uff09",
      bookDescriptionTemplate: "\u8def\u5f84\uff1a{{book.path}}",
      pageTitleTemplate: "\u7b2c {{page.indexDisplay}} / {{book.totalPages}} \u9875",
      pageDescriptionTemplate: "{{page.dimensionsFormatted}}  {{page.sizeFormatted}}",
      positionX: 20,
      positionY: 20,
      opacity: 0.92,
      liquidGlass: false,
    })
  })

  it("[neoview.switch-toast.legacy-normalize] fills missing fields and imports showBookSwitchToast", () => {
    expect(normalizeReaderSwitchToast({ enablePage: true }, { showBookSwitchToast: true })).toEqual({
      ...DEFAULT_READER_SWITCH_TOAST,
      enableBook: true,
      enablePage: true,
    })
    expect(normalizeReaderSwitchToast({ enableBook: false }, { showBookSwitchToast: true }).enableBook).toBe(false)
    expect(normalizeReaderSwitchToast(undefined, { showBookSwitchToast: "yes" })).toEqual(DEFAULT_READER_SWITCH_TOAST)
  })

  it("[neoview.switch-toast.bounds] clamps loaded geometry and strictly rejects invalid patches", () => {
    expect(normalizeReaderSwitchToast({ positionX: -5, positionY: 9_000, opacity: 0 })).toMatchObject({
      positionX: 0,
      positionY: 4_096,
      opacity: 0.1,
    })
    expect(parseReaderSwitchToastPatch({ positionX: 0, positionY: 4_096, opacity: 1 })).toEqual({
      positionX: 0,
      positionY: 4_096,
      opacity: 1,
    })
    expect(() => parseReaderSwitchToastPatch({ positionX: -1 })).toThrow(RangeError)
    expect(() => parseReaderSwitchToastPatch({ opacity: Number.NaN })).toThrow(RangeError)
    expect(() => parseReaderSwitchToastPatch({ enableAction: "yes" })).toThrow(TypeError)
    expect(() => parseReaderSwitchToastPatch({ future: true })).toThrow(/Unknown/)
  })

  it("[neoview.switch-toast.patch] preserves unpatched fields and validates template types", () => {
    expect(applyReaderSwitchToastPatch(DEFAULT_READER_SWITCH_TOAST, {
      enableBook: true,
      bookTitleTemplate: "{{book.emmTranslatedTitle}}",
    })).toEqual({
      ...DEFAULT_READER_SWITCH_TOAST,
      enableBook: true,
      bookTitleTemplate: "{{book.emmTranslatedTitle}}",
    })
    expect(() => parseReaderSwitchToastPatch({ pageTitleTemplate: 42 })).toThrow(TypeError)
  })

  it("[neoview.switch-toast.template] renders known variables and preserves unknown roots", () => {
    const context: ReaderSwitchToastContext = {
      book: {
        name: "demo.cbz",
        displayName: "Demo",
        path: "D:/Books/demo.cbz",
        type: "archive",
        totalPages: 12,
        currentPageIndex: 2,
        currentPageDisplay: 3,
        progressPercent: 25,
        emmTags: { artist: ["A"] },
      },
      page: {
        name: "003.jpg",
        displayName: "003.jpg",
        path: "D:/Books/demo.cbz",
        innerPath: "003.jpg",
        index: 2,
        indexDisplay: 3,
        dimensionsFormatted: "1200 x 1800",
        sizeFormatted: "1.2 MiB",
      },
    }
    expect(renderReaderSwitchToastTemplate(
      "{{ book.displayName }} {{page.name}} {{book.emmTags}} {{book.emmTags.artist.0}} {{other.value}}",
      context,
    )).toBe('Demo 003.jpg {"artist":["A"]} A {{other.value}}')
    expect(renderReaderSwitchToastTemplate("{{book.missing}}/{{page.width}}", context)).toBe("/")
    expect(renderReaderSwitchToastTemplate("{{book.displayName}}", { book: null, page: null })).toBe("")
    expect(renderReaderSwitchToastTemplate(undefined, context)).toBe("")
  })
})
