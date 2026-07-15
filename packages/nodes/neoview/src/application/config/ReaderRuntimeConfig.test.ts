import { describe, expect, it } from "vitest"
import { parseNeoviewRuntimeConfig } from "./ReaderRuntimeConfig.js"

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
    expect(parseNeoviewRuntimeConfig(undefined)).toEqual({ schemaVersion: 1, sessionOptions: {} })
  })
})
