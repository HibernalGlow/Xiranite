import { describe, expect, it } from "vitest"

import {
  DEFAULT_READER_PAGE_TRANSITION,
  normalizeReaderPageTransition,
  parseReaderPageTransitionPatch,
  projectReaderPageTransitionCss,
  READER_PAGE_TRANSITION_EASING_CSS,
  READER_PAGE_TRANSITION_EASING_LABELS,
  READER_PAGE_TRANSITION_EASINGS,
  READER_PAGE_TRANSITION_TYPE_LABELS,
  READER_PAGE_TRANSITION_TYPES,
} from "./ReaderPageTransition.js"

describe("ReaderPageTransition", () => {
  it("[neoview.page-transition.types] preserves exact legacy type IDs, order and labels", () => {
    expect(READER_PAGE_TRANSITION_TYPES).toEqual(["none", "fade", "slide", "slideUp", "zoom", "flip"])
    expect(READER_PAGE_TRANSITION_TYPE_LABELS).toEqual({
      none: "\u65e0\u52a8\u753b", fade: "\u6de1\u5165\u6de1\u51fa", slide: "\u6c34\u5e73\u6ed1\u52a8",
      slideUp: "\u5782\u76f4\u6ed1\u52a8", zoom: "\u7f29\u653e", flip: "\u7ffb\u8f6c",
    })
  })

  it("[neoview.page-transition.easing] [neoview.page-transition.css] preserves all legacy easing IDs and CSS", () => {
    expect(READER_PAGE_TRANSITION_EASINGS).toEqual([
      "linear", "ease", "easeIn", "easeOut", "easeInOut", "easeOutQuad", "easeOutCubic",
    ])
    expect(READER_PAGE_TRANSITION_EASING_CSS).toEqual({
      linear: "linear", ease: "ease", easeIn: "ease-in", easeOut: "ease-out", easeInOut: "ease-in-out",
      easeOutQuad: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
      easeOutCubic: "cubic-bezier(0.215, 0.61, 0.355, 1)",
    })
    expect(Object.keys(READER_PAGE_TRANSITION_EASING_LABELS)).toEqual(READER_PAGE_TRANSITION_EASINGS)
  })

  it("[neoview.page-transition.bounds] normalizes imported values to 0..1000 but strictly bounds GUI patches to 0..500", () => {
    expect(normalizeReaderPageTransition({ enabled: true, type: "slide", duration: 2_000, easing: "ease" })).toEqual({
      enabled: true, type: "slide", duration: 1_000, easing: "ease",
    })
    expect(normalizeReaderPageTransition({ duration: -5 }).duration).toBe(0)
    expect(parseReaderPageTransitionPatch({ duration: 500 })).toEqual({ duration: 500 })
    expect(parseReaderPageTransitionPatch({ duration: 10.5 })).toEqual({ duration: 10.5 })
    expect(() => parseReaderPageTransitionPatch({ duration: 501 })).toThrow(RangeError)
    expect(() => parseReaderPageTransitionPatch({ duration: Number.NaN })).toThrow(RangeError)
    expect(() => parseReaderPageTransitionPatch({ future: true })).toThrow(/Unknown/)
  })

  it("[neoview.page-transition.config] [neoview.page-transition.reset] preserves exact defaults", () => {
    expect(DEFAULT_READER_PAGE_TRANSITION).toEqual({ enabled: false, type: "none", duration: 0, easing: "easeOutQuad" })
    expect(normalizeReaderPageTransition(undefined)).toEqual(DEFAULT_READER_PAGE_TRANSITION)
  })

  it("[neoview.page-transition.direction] projects exact directional legacy transforms", () => {
    const base = { ...DEFAULT_READER_PAGE_TRANSITION, enabled: true, duration: 240, easing: "easeOutQuad" as const }
    expect(projectReaderPageTransitionCss({ ...base, type: "slide" }, "next").from).toEqual({ transform: "translateX(30%)", opacity: 0 })
    expect(projectReaderPageTransitionCss({ ...base, type: "slide" }, "prev").from).toEqual({ transform: "translateX(-30%)", opacity: 0 })
    expect(projectReaderPageTransitionCss({ ...base, type: "slideUp" }, "next").from.transform).toBe("translateY(30%)")
    expect(projectReaderPageTransitionCss({ ...base, type: "zoom" }, "prev").from.transform).toBe("scale(1.1)")
    expect(projectReaderPageTransitionCss({ ...base, type: "flip" }, "next").from.transform).toBe("perspective(1000px) rotateY(-15deg)")
    expect(projectReaderPageTransitionCss({ ...base, type: "fade" }, "prev")).toMatchObject({
      className: "page-transition-fade-enter-prev",
      transition: "transform 240ms cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 240ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
      from: { opacity: 0 },
      to: { opacity: 1 },
    })
    expect(projectReaderPageTransitionCss(base, "next")).toEqual({ enabled: false, className: "", transition: "none", from: {}, to: {} })
  })
})
